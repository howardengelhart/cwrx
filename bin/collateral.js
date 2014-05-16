#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path        = require('path'),
        q           = require('q'),
        aws         = require('aws-sdk'),
        fs          = require('fs-extra'),
        phantom     = require('phantom'),
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
        cacheTTLs: {  // units here are minutes
            auth: {
                freshTTL: 1,
                maxTTL: 10
            }
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
    
    // TODO comment, make sure to mention how versionate -> no replace, !versionate -> replace
    collateral.upload = function(req, org, fileOpts, versionate, s3, config) {
        var log = logger.getLog(),
            outParams = {},
            headParams = {},
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
                Bucket      : config.s3.bucket,
                Key         : path.join(config.s3.path, org, fname),
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
    
    collateral.uploadFiles = function(req, s3, config) {
        var log = logger.getLog(),
            org = req.user.org;

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
        
        if (req.query && req.query.org && req.query.org !== req.user.org) {
            if (req.user.permissions && req.user.permissions.experiences &&
                req.user.permissions.experiences.edit === Scope.All) {
                log.info('[%1] Admin user %2 is uploading file to org %3',req.uuid,req.user.id,org);
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
        
        return q.allSettled(Object.keys(req.files).map(function(objName) {
            var file = req.files[objName];
            
            if (file.size > config.maxFileSize) {
                log.warn('[%1] File %2 is %3 bytes large, which is too big',
                         req.uuid, file.name, file.size);
                cleanup(file.path);
                return q.reject({ code: 413, name: objName, error: 'File is too big' });
            }
            
            return collateral.upload(req, org, file, true, s3, config)
            .then(function(key) {
                log.info('[%1] File %2 has been uploaded successfully', req.uuid, file.name);
                return q({ code: 201, name: objName, path: key });
            })
            .catch(function(error) {
                log.error('[%1] Error processing upload for %2: %3', req.uuid, file.name, error);
                return q.reject({ code: 500, name: objName, error: error });
            })
            .finally(function() { cleanup(file.path); });
        }))
        .then(function(results) {
            var retArray = [], reqCode = 201;
            
            results.forEach(function(result) {
                if (result.state === 'fulfilled') {
                    retArray.push({
                        name:   result.value.name,
                        code:   result.value.code,
                        path:   result.value.path
                    });
                } else {
                    reqCode = Math.max(result.reason.code, reqCode); // prefer 5xx over 4xx over 2xx
                    retArray.push({
                        name:   result.reason.name,
                        code:   result.reason.code,
                        error:  result.reason.error
                    });
                }
            });
            return q({code: reqCode, body: retArray});
        })
        .catch(function(error) {
            log.error('[%1] Error processing uploads: %2', req.uuid, error);
            return q.reject(error);
        });
    };
    
    //TODO: we will need phantomjs installed, which will require cookbook changes
    //TODO: should we sanity check or default the size?
    //TODO: Need unit and e2e tests
    collateral.generateSplash = function(req, s3, config) {
        var log = logger.getLog();
        if (!(req.body.thumbs instanceof Array) || req.body.thumbs.length === 0) {
            log.info('[%1] No thumbs to generate a splash from', req.uuid);
            return q({code: 400, body: 'Must provide thumbs to create splash from'});
        }
        if (!req.body.size || !req.body.size.height || !req.body.size.width) {
            log.info('[%1] No size provided in request', req.uuid);
            return q({code: 400, body: 'Must provide size object with width + height'});
        }
        if (!req.body.id) {
            log.info('[%1] No experience id provided', req.uuid);
            return q({code: 400, body: 'Need an experience id to name image with'});
        }

//TODO: fix templatePath based on actual template names/paths, may need templ name from client
        var numThumbs       = req.body.thumbs.length,
            templateNum     = (numThumbs % 2) ? Math.max(numThumbs - 1, 1) : numThumbs,
            templatePath    = path.join('splashTemplates', 'template' + templateNum + '.html'),
            compiledPath    = path.join('/tmp', req.body.id + '-compiled.html'),
            splashName      = req.body.id + '-splash.jpg',
            // splashName      = req.body.id + '-splash.png',
            splashPath      = path.join('/tmp', splashName),
            deferred        = q.defer(),
            ph, page;
        
        // Phantom callbacks only callback with one arg, so we need to transform to Nodejs style
        function phantWrap(object, method, args, cb) {
            args.push(function(result) { cb(null, result); });
            object[method].apply(object, args);
        }
            
        log.info('[%1] User %2 generating splash for %3 from %4 thumbs',
                 req.uuid, req.user.id, req.body.id, numThumbs);
        
        // Start by reading and rendering our template with handlebars
        q.npost(fs, 'readFile', [templatePath, {encoding: 'utf8'}])
        .then(function(template) {
            var data = {thumbs: req.body.thumbs}, //TODO: format data based on links
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
                deferred.reject('PhantomJS exited prematurely');
            }
            function onStderr(data) {
                if (data.match(/(No such method.*socketSentData)|(CoreText performance note)/)) {
                    return;
                }
                log.error('[%1] Phantom had an error: %2', req.uuid, data);
            }
            return q.nfapply(phantWrap, [phantom, 'create', [{onExit:onExit, onStderr:onStderr}]]);
        })
        .then(function(phantObj) {
            ph = phantObj;
            return q.nfapply(phantWrap, [ph, 'createPage', []]);
        })
        .then(function(webpage) { // Set viewportSize to create image of desired size
            page = webpage;
            log.trace('[%1] Created page, setting viewport size', req.uuid);
            return q.nfapply(phantWrap, [page, 'set', ['viewportSize', req.body.size]]);
        })
        .then(function() { // Open the compiled html
            return q.nfapply(phantWrap, [page, 'open', [compiledPath]]);
        })
        .then(function(status) { // Render page as image
            if (status !== 'success') {
                return q.reject('Failed to open ' + compiledPath + ': status was ' + status);
            }
            log.trace('[%1] Opened page, rendering image', req.uuid);
            return q.nfapply(phantWrap, [page, 'render', [splashPath]]);
        })
        .then(function() { // Upload the rendered splash image to S3
            log.trace('[%1] Rendered image', req.uuid);
            var fileOpts = {
                name: splashName,
                path: splashPath,
                type: 'image/jpeg'
            };
            return collateral.upload(req, req.user.org, fileOpts, !!req.body.published, s3, config);
        })
        .then(function(key) {
            log.info('[%1] File %2 has been uploaded successfully', req.uuid, splashName);
            deferred.resolve({ code: 201, body: key });
        })
        .catch(function(error) {
            log.error('[%1] Error generating splash image: %2', req.uuid, util.inspect(error));
            deferred.reject(error);
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

        app.post('/api/collateral/splash/generate', sessionsWrapper, authUpload, function(req,res){
            collateral.generateSplash(req, s3, state.config)
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
