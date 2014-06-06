#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path        = require('path'),
        q           = require('q'),
        aws         = require('aws-sdk'),
        fs          = require('fs-extra'),
        phantom     = require('phantom'),
        glob        = require('glob'),
        handlebars  = require('handlebars'),
        util        = require('util'),
        logger      = require('../lib/logger'),
        uuid        = require('../lib/uuid'),
        authUtils   = require('../lib/authUtils')(),
        service     = require('../lib/service'),
        s3util      = require('../lib/s3util'),
        enums       = require('../lib/enums'),
        Scope       = enums.Scope,
        
        state      = {},
        collateral = {}; // for exporting functions to unit tests

    state.name = 'collateral';
    // This is the template for collateral's configuration
    state.defaultConfig = {
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/collateral/caches/run/'),
        },
        cacheControl: {
            default: 'max-age=15'
        },
        cacheTTLs: {  // units here are minutes
            auth: {
                freshTTL: 1,
                maxTTL: 10
            }
        },
        splash: {
            quality: 75, // some integer between 0 and 100
            maxDimension: 1000, // pixels, either height or width, to provide basic sane limit
            timeout: 10*1000 // timeout for entire splash generation process; 10 seconds
        },
        maxFileSize: 25*1000*1000, // 25MB
        s3: {
            bucket: 'c6.dev',
            path: 'collateral/',
            region: 'us-east-1'
        },
        sessions: {
            key: 'c6Auth',
            maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
            minAge: 60*1000, // TTL for cookies for unauthenticated users
            mongo: {
                host: null,
                port: null,
                retryConnect : true
            }
        },
        secretsPath: path.join(process.env.HOME,'.collateral.secrets.json'),
        mongo: {
            c6Db: {
                host: null,
                port: null,
                retryConnect : true
            }
        }
    };
    
    /**
     * Upload a single file to S3. If versionate is true, this will use uuid.hashFile to create a
     * new versioned file name, check S3 for an existing file with this name, and upload if missing.
     * If versionate is false, this will just upload the file directly to S3 (overwriting any
     * existing file with that unmodified file name).
     */
    collateral.upload = function(req, prefix, fileOpts, versionate, s3, config) {
        var log = logger.getLog(),
            outParams = {},
            headParams = {},
            cacheControl = req.query && req.query.noCache ? 'max-age=0'
                                                          : config.cacheControl.default,
            promise;

        if (versionate) {
            promise = uuid.hashFile(fileOpts.path).then(function(hash) {
                return q(hash + '.' + fileOpts.name);
            });
        } else {
            promise = q(fileOpts.name);
        }
        
        return promise.then(function(fname) {
            outParams = {
                CacheControl: cacheControl,
                Bucket      : config.s3.bucket,
                Key         : path.join(prefix, fname),
                ACL         : 'public-read',
                ContentType : fileOpts.type
            };
            headParams = {Key: outParams.Key, Bucket: outParams.Bucket};
            
            log.info('[%1] User %2 is uploading file to %3/%4',
                     req.uuid, req.user.id, outParams.Bucket, outParams.Key);

            if (versionate) {
                return q.npost(s3, 'headObject', [headParams]).then(function(/*data*/) {
                    log.info('[%1] Identical file %2 already exists on s3, not uploading',
                             req.uuid, fname);
                    return q(outParams.Key);
                })
                .catch(function(/*error*/) {
                    return s3util.putObject(s3, fileOpts.path, outParams)
                    .thenResolve(outParams.Key);
                });
            } else {
                log.info('[%1] Not versionating, overwriting potential existing file', req.uuid);
                return s3util.putObject(s3, fileOpts.path, outParams)
                .thenResolve(outParams.Key);
            }
        });
    };

    // Check and return the filetype of image at fpath, returning false if unsupported
    collateral.checkImageType = function(fpath) {
        var fileTypes = [
            { type: 'image/jpeg', sig: [0xff, 0xd8, 0xff] },
            { type: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
            { type: 'image/gif', sig: [0x47, 0x49, 0x46, 0x38, [0x37, 0x39], 0x61] }
        ];
        
        function checkSig(sig, buff) {
            return sig.every(function(sigVal, i) {
                if (sigVal instanceof Array) {
                    return sigVal.some(function(option) { return option === buff[i]; });
                } else {
                    return buff[i] === sigVal;
                }
            });
        }
        
        return q.npost(fs, 'readFile', [fpath]).then(function(buffer) {
            for (var i = 0; i < fileTypes.length; i++) {
                if (checkSig(fileTypes[i].sig, buffer)) {
                    return q(fileTypes[i].type);
                }
            }
            return false;
        });
    };

    // Upload a file from req.files to S3
    collateral.uploadFiles = function(req, s3, config) {
        var log = logger.getLog(),
            org = req.user.org,
            versionate = req.query && req.query.versionate || false,
            prefix;

        function cleanup(fpath) {
            q.npost(fs, 'remove', [fpath])
            .then(function() {
                log.trace('[%1] Successfully removed %2', req.uuid, fpath);
            })
            .catch(function(error) {
                log.warn('[%1] Unable to remove %2: %3', req.uuid, fpath, error);
            });
        }

        if (typeof req.files !== 'object' || Object.keys(req.files).length === 0) {
            log.info('[%1] No files to upload from user %2', req.uuid, req.user.id);
            return q({code: 400, body: 'Must provide files to upload'});
        } else {
            log.info('[%1] User %2 is uploading %3 files',
                     req.uuid, req.user.id, Object.keys(req.files).length);
        }
        
        if (req.params && req.params.expId) {
            prefix = path.join(config.s3.path, req.params.expId);
        } else {
            if (req.query && req.query.org && req.query.org !== req.user.org) {
                if (req.user.permissions && req.user.permissions.experiences &&
                    req.user.permissions.experiences.edit === Scope.All) {
                    log.info('[%1] Admin user %2 is uploading file to org %3',
                             req.uuid, req.user.id, org);
                    org = req.query.org;
                } else {
                    log.info('[%1] Non-admin user %2 tried to upload files to org %3',
                             req.uuid, req.user.id, org);
                    Object.keys(req.files).forEach(function(key) {
                        cleanup(req.files[key].path);
                    });
                    return q({code: 403, body: 'Cannot upload files to that org'});
                }
            }
            prefix = path.join(config.s3.path, org);
        }
        
        return q.allSettled(Object.keys(req.files).map(function(objName) {
            var file = req.files[objName];
            
            if (file.size > config.maxFileSize) {
                log.warn('[%1] File %2 is %3 bytes large, which is too big',
                         req.uuid, file.name, file.size);
                cleanup(file.path);
                return q.reject({ code: 413, name: objName, error: 'File is too big' });
            }
            
            var deferred = q.defer();
            
            collateral.checkImageType(file.path)
            .then(function(type) {
                if (!type) {
                    log.warn('[%1] File %2 is not a jpeg, png, or gif', req.uuid, file.name);
                    return deferred.reject({code:415, name:objName, error:'Unsupported file type'});
                }
                
                file.type = type;

                return collateral.upload(req, prefix, file, versionate, s3, config)
                .then(function(key) {
                    log.info('[%1] File %2 has been uploaded successfully', req.uuid, file.name);
                    deferred.resolve({ code: 201, name: objName, path: key });
                });
            })
            .catch(function(error) {
                log.error('[%1] Error processing upload for %2: %3', req.uuid, file.name, error);
                deferred.reject({ code: 500, name: objName, error: error });
            })
            .finally(function() { cleanup(file.path); });
            
            return deferred.promise;
        }))
        .then(function(results) {
            var retArray = [], reqCode = 201;
            
            results.forEach(function(result) {
                if (result.state === 'fulfilled') {
                    retArray.push(result.value);
                } else {
                    reqCode = Math.max(result.reason.code, reqCode); // prefer 5xx over 4xx over 2xx
                    retArray.push(result.reason);
                }
            });
            return q({code: reqCode, body: retArray});
        })
        .catch(function(error) {
            log.error('[%1] Error processing uploads: %2', req.uuid, error);
            return q.reject(error);
        });
    };
    
    // If num === 5 return 4, if num > 6 return 6, else return num
    collateral.chooseTemplateNum = function(num) {
        return Math.min(((num % 2 && num > 4) ? Math.max(num - 1, 1) : num), 6);
    };
    
    // Generate a single splash image using the imgSpec and req.body.thumbs
    collateral.generateSplash = function(req, imgSpec, s3, config) {
        var log = logger.getLog(),
            versionate = req.query && req.query.versionate || false,
            splashName = imgSpec && imgSpec.name || 'splash',
            templateDir = path.join(__dirname, '../splashTemplates');

        function resolveObj(code, path) {
            return {
                name: splashName,
                ratio: imgSpec && imgSpec.ratio || '',
                code: code,
                path: path
            };
        }
        
        function rejectObj(code, error) {
            return {
                name: splashName,
                ratio: imgSpec && imgSpec.ratio || '',
                code: code,
                error: error
            };
        }
        if (!imgSpec || !imgSpec.width || !imgSpec.height || !imgSpec.ratio) {
            log.info('[%1] Incomplete imgSpec for %2: %3',
                     req.uuid, splashName, JSON.stringify(imgSpec));
            return q.reject(rejectObj(400, 'Must provide complete imgSpec'));
        }
        else if (imgSpec.height > config.splash.maxDimension ||
                   imgSpec.width > config.splash.maxDimension) {
            log.info('[%1] Trying to create %2x%3 image but limit is %4x%4',
                     req.uuid, imgSpec.width, imgSpec.height, config.splash.maxDimension);
            return q.reject(rejectObj(400, 'Requested image size is too large'));
        }
        
        if (glob.sync(path.join(templateDir, imgSpec.ratio + '*')).length === 0) {
            log.info('[%1] Invalid ratio name %2', req.uuid, imgSpec.ratio);
            return q.reject(rejectObj(400, 'Invalid ratio name'));
        }
        
        var templateNum     = collateral.chooseTemplateNum(req.body.thumbs.length),
            templatePath    = path.join(templateDir, imgSpec.ratio + '_x' + templateNum + '.html'),
            jobId           = uuid.createUuid(),
            compiledPath    = path.join('/tmp', jobId + '-compiled.html'),
            splashPath      = path.join('/tmp', jobId + '-' + splashName + '.jpg'),
            deferred        = q.defer(),
            prefix          = path.join(config.s3.path, req.params.expId),
            ph, page;

        // Phantom callbacks only callback with one arg, so we need to transform to Nodejs style
        function phantWrap(object, method, args, cb) {
            args.push(function(result) { cb(null, result); });
            object[method].apply(object, args);
        }
            
        log.info('[%1] Generating splash %2 at %3x%4 with ratio %5',
                 req.uuid, splashName, imgSpec.width, imgSpec.height, imgSpec.ratio);
        
        // Start by reading and rendering our template with handlebars
        q.npost(fs, 'readFile', [templatePath, {encoding: 'utf8'}])
        .then(function(template) {
            var data = {thumbs: req.body.thumbs},
                compiled = handlebars.compile(template)(data);

            return q.npost(fs, 'writeFile', [compiledPath, compiled]);
        })

        .then(function() { // Start setting up phantomjs
            log.trace('[%1] Wrote compiled html, starting phantom', req.uuid);
            function onExit(code, signal) {
                if (code === 0) {
                    return;
                }
                log.error('[%1] Phantom exited with code %2, signal %3', req.uuid, code, signal);
                deferred.reject(rejectObj(500, 'PhantomJS exited prematurely'));
            }

            // this mostly copies the default onStderr but replaces their console.warn with our log
            function onStderr(data) {
                if (data.match(/(No such method.*socketSentData)|(CoreText performance note)/)) {
                    return;
                }
                log.warn('[%1] Phantom had an error: %2', req.uuid, data);
            }

            return q.nfapply(phantWrap, [phantom, 'create', [{onExit:onExit, onStderr:onStderr}]]);
        })
        .then(function(phantObj) { // Create a page object
            ph = phantObj;
            return q.nfapply(phantWrap, [ph, 'createPage', []]);
        })
        .then(function(webpage) { // Set viewportSize to create image of desired size
            page = webpage;
            log.trace('[%1] Created page, setting viewport size', req.uuid);
            var size = { height: imgSpec.height, width: imgSpec.width };
            return q.nfapply(phantWrap, [page, 'set', ['viewportSize', size]]);
        })
        .then(function() { // Open the compiled html
            return q.nfapply(phantWrap, [page, 'open', [compiledPath]]);
        })
        .then(function(status) { // Render page as image
            if (status !== 'success') {
                return q.reject('Failed to open ' + compiledPath + ': status was ' + status);
            }
            log.trace('[%1] Opened page, rendering image', req.uuid);
            var opts = { quality: config.splash.quality };
            return q.nfapply(phantWrap, [page, 'render', [splashPath, opts]]);
        })

        .then(function() { // Upload the rendered splash image to S3
            log.trace('[%1] Rendered image', req.uuid);
            var fileOpts = {
                name: splashName,
                path: splashPath,
                type: 'image/jpeg'
            };
            return collateral.upload(req, prefix, fileOpts, versionate, s3, config);
        })
        
        .then(function(key) {
            log.info('[%1] File %2 has been uploaded successfully', req.uuid, splashName);
            deferred.resolve(resolveObj(201, key));
        })
        .timeout(config.splash.timeout)
        .catch(function(error) {
            log.error('[%1] Error generating splash image: %2', req.uuid, util.inspect(error));
            deferred.reject(rejectObj(500, error));
        })

        .finally(function() { // Cleanup by removing compiled template + splash image
            page.close();
            ph.exit();
            [compiledPath, splashPath].map(function(fpath) {
                q.npost(fs, 'remove', [fpath])
                .then(function() {
                    log.trace('[%1] Successfully removed %2', req.uuid, fpath);
                })
                .catch(function(error) {
                    log.warn('[%1] Unable to remove %2: %3', req.uuid, fpath, error);
                });
            });
        });
        
        return deferred.promise;
    };
    
    // Create multiple spash images based on the req.body.imageSpecs
    collateral.createSplashes = function(req, s3, config) {
        var log = logger.getLog();
        
        if (!req.body || !(req.body.thumbs instanceof Array) || req.body.thumbs.length === 0) {
            log.info('[%1] No thumbs to generate splashes from', req.uuid);
            return q({code: 400, body: 'Must provide thumbs to create splashes from'});
        }
        
        if (!(req.body.imageSpecs instanceof Array) || req.body.imageSpecs.length === 0) {
            log.info('[%1] No imageSpecs to generate splashes for', req.uuid);
            return q({code: 400, body: 'Must provide imageSpecs to create splashes for'});
        }
        
        log.info('[%1] User %2 generating %3 splashes for %4 from %5 thumbs',req.uuid,
                 req.user.id,req.body.imageSpecs.length,req.params.expId,req.body.thumbs.length);
        
        return q.allSettled(req.body.imageSpecs.map(function(imgSpec) {
            return collateral.generateSplash(req, imgSpec, s3, config);
        })).then(function(results) {
            var retArray = [], reqCode = 201;
            
            results.forEach(function(result) {
                if (result.state === 'fulfilled') {
                    retArray.push(result.value);
                } else {
                    reqCode = Math.max(result.reason.code, reqCode); // prefer 5xx over 4xx over 2xx
                    retArray.push(result.reason);
                }
            });
            return q({code: reqCode, body: retArray});
        }).catch(function(error) {
            log.error('[%1] Error creating splash images: %2', req.uuid, util.inspect(error));
            return q.reject(error);
        });
    };

    collateral.main = function(state) {
        var log = logger.getLog(),
            started = new Date(),
            s3;
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');
            
        var express     = require('express'),
            app         = express(),
            users       = state.dbs.c6Db.collection('users'),
            authTTLs    = state.config.cacheTTLs.auth;
        authUtils = require('../lib/authUtils')(authTTLs.freshTTL, authTTLs.maxTTL, users);
        
        // If running locally, you need to put AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in env
        aws.config.region = state.config.s3.region;
        s3 = new aws.S3();

        app.use(express.bodyParser());
        app.use(express.cookieParser(state.secrets.cookieParser || ''));
        
        var sessions = express.session({
            key: state.config.sessions.key,
            cookie: {
                httpOnly: false,
                maxAge: state.config.sessions.minAge
            },
            store: state.sessionStore
        });

        state.dbStatus.c6Db.on('reconnected', function() {
            users = state.dbs.c6Db.collection('users');
            authUtils._cache._coll = users;
            log.info('Recreated collections from restarted c6Db');
        });
        
        state.dbStatus.sessions.on('reconnected', function() {
            sessions = express.session({
                key: state.config.sessions.key,
                cookie: {
                    httpOnly: false,
                    maxAge: state.config.sessions.minAge
                },
                store: state.sessionStore
            });
            log.info('Recreated session store from restarted db');
        });

        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessionsWrapper(req, res, next) {
            sessions(req, res, next);
        }

        app.all('*', function(req, res, next) {
            res.header('Access-Control-Allow-Headers',
                       'Origin, X-Requested-With, Content-Type, Accept');
            res.header('cache-control', 'max-age=0');

            if (req.method.toLowerCase() === 'options') {
                res.send(200);
            } else {
                next();
            }
        });

        app.all('*', function(req, res, next) {
            req.uuid = uuid.createUuid().substr(0,10);
            if (!req.headers['user-agent'] || !req.headers['user-agent'].match(/^ELB-Health/)) {
                log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            } else {
                log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            }
            next();
        });
        
        var authUpload = authUtils.middlewarify({});

        app.post('/api/collateral/files/:expId', sessionsWrapper, authUpload, function(req,res){
            collateral.uploadFiles(req, s3, state.config)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error uploading files',
                    detail: error
                });
            });
        });
        
        app.post('/api/collateral/files', sessionsWrapper, authUpload, function(req,res){
            collateral.uploadFiles(req, s3, state.config)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error uploading files',
                    detail: error
                });
            });
        });

        app.post('/api/collateral/splash/:expId', sessionsWrapper, authUpload, function(req, res) {
            collateral.createSplashes(req, s3, state.config)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error uploading files',
                    detail: error
                });
            });
        });

        app.get('/api/collateral/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/collateral/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.use(function(err, req, res, next) {
            if (err) {
                log.error('Error: %1', err);
                res.send(500, 'Internal error');
            } else {
                next();
            }
        });
        
        app.listen(state.cmdl.port);
        log.info('Service is listening on port: ' + state.cmdl.port);

        return state;
    };

    if (!__ut__){
        service.start(state)
        .then(service.parseCmdLine)
        .then(service.configure)
        .then(service.prepareServer)
        .then(service.daemonize)
        .then(service.cluster)
        .then(service.initMongo)
        .then(service.initSessionStore)
        .then(collateral.main)
        .catch(function(err) {
            var log = logger.getLog();
            console.log(err.message || err);
            log.error(err.message || err);
            if (err.code)   {
                process.exit(err.code);
            }
            process.exit(1);
        }).done(function(){
            var log = logger.getLog();
            log.info('ready to serve');
        });
    } else {
        module.exports = collateral;
    }
}());
