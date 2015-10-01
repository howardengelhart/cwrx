#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path        = require('path'),
        util        = require('util'),
        q           = require('q'),
        aws         = require('aws-sdk'),
        fs          = require('fs-extra'),
        phantom     = require('phantom'),
        glob        = require('glob'),
        handlebars  = require('handlebars'),
        request     = require('request-promise'),
        express     = require('express'),
        bodyParser  = require('body-parser'),
        multer      = require('multer'),
        sessionLib  = require('express-session'),
        logger      = require('../lib/logger'),
        uuid        = require('../lib/uuid'),
        authUtils   = require('../lib/authUtils'),
        journal     = require('../lib/journal'),
        service     = require('../lib/service'),
        JobManager  = require('../lib/jobManager'),
        s3util      = require('../lib/s3util'),
        PromiseTimer= require('../lib/promise').Timer,
        parseURL    = require('url').parse,

        state      = {},
        collateral = {}; // for exporting functions to unit tests

    // This is the template for collateral's configuration
    state.defaultConfig = {
        appName: 'collateral',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/collateral/caches/run/'),
        },
        cacheControl: {
            default: 'max-age=31556926'
        },
        splash: {
            quality: 75,            // some integer between 0 and 100
            maxDimension: 1000,     // pixels, either height or width, to provide basic sane limit
            cacheTTL: 24*3600*1000, // max age of md5 in cache; units = ms
            maxCacheKeys: 30000,    // max number of cached md5s in the in-memory cache
            clearInterval: 60*1000, // how often to check for old cached md5s; units = ms
            timeout: 10*1000        // timeout for entire splash generation process; units = ms
        },
        maxFileSize: 25*1000*1000,  // 25MB
        maxFiles: 10,               // max number of files svc will handle in a request
        maxDownloadTime: 15*1000,   // timeout for downloading image uris from 3rd-party server
        s3: {
            bucket: 'c6.dev',
            path: 'collateral/',
            region: 'us-east-1'
        },
        sessions: {
            key: 'c6Auth',
            maxAge: 14*24*60*60*1000,   // 14 days; unit here is milliseconds
            minAge: 60*1000,            // TTL for cookies for unauthenticated users
            secure: false,              // true == HTTPS-only; set to true for staging/production
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
            },
            c6Journal: {
                host: null,
                port: null,
                retryConnect : true
            }
        },
        pubsub: {
            cacheCfg: {
                port: 21211,
                isPublisher: false
            }
        },
        cache: {
            timeouts: {},
            servers: null
        },
        jobTimeouts: {
            enabled: true,
            urlPrefix: '/api/collateral/job',
            timeout: 5*1000,
            cacheTTL: 60*60*1000,
        }
    };

    function ServiceResponse(code, body) {
        this.code = code;
        this.body = body;
    }

    /**
     * Upload a single file to S3. If versionate is true, this will use uuid.hashFile to create a
     * new versioned file name, check S3 for an existing file with this name, and upload if missing.
     * If versionate is false, this will just upload the file directly to S3 (overwriting any
     * existing file with that unmodified file name).
     */
    collateral.upload = function(req, prefix, fileOpts, s3, config) {
        var log = logger.getLog(),
            outParams = {},
            headParams = {};

        return uuid.hashFile(fileOpts.path)
        .then(function(hash) {
            return q(hash + path.extname(fileOpts.path));
        })
        .then(function(fname) {
            outParams = {
                CacheControl: config.cacheControl.default,
                Bucket      : config.s3.bucket,
                Key         : path.join(prefix, fname),
                ACL         : 'public-read',
                ContentType : fileOpts.type
            };
            headParams = {Key: outParams.Key, Bucket: outParams.Bucket};
            
            log.info('[%1] User %2 is uploading file to %3/%4',
                     req.uuid, req.user.id, outParams.Bucket, outParams.Key);

            return q.npost(s3, 'headObject', [headParams]).then(function(data) {
                log.info('[%1] Identical file %2 already exists on s3, not uploading',
                         req.uuid, fname);
                return q({ key: outParams.Key, md5: data.ETag.replace(/"/g, '') });
            })
            .catch(function(/*error*/) {
                return s3util.putObject(s3, fileOpts.path, outParams)
                .then(function(data) {
                    return q({ key: outParams.Key, md5: data.ETag.replace(/"/g, '') });
                });
            });
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
            user = req.user,
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

        prefix = path.join(config.s3.path, 'userFiles/' + user.id);
        
        return q.allSettled(Object.keys(req.files).map(function(objName) {
            var file = req.files[objName];
            
            if (!!file.truncated) {
                log.warn('[%1] File %2 is greater than %3 bytes, not uploading',
                         req.uuid, file.name, config.maxFileSize);
                cleanup(file.path);
                return q.reject({ code: 413, name: objName, error: 'File is too big' });
            }
            
            var deferred = q.defer();
            
            collateral.checkImageType(file.path)
            .then(function(type) {
                if (!type) {
                    log.warn('[%1] File %2 is not a jpeg, png, or gif', req.uuid, file.name);
                    return deferred.reject({code:415,name:objName,error:'Unsupported file type'});
                }
                
                file.type = type;

                return collateral.upload(req, prefix, file, s3, config)
                .then(function(response) {
                    log.info('[%1] File %2 has been uploaded successfully', req.uuid, file.name);
                    deferred.resolve({ code: 201, name: objName, path: response.key });
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

    collateral.importFile = function(req, s3, config) {
        var log = logger.getLog();

        var maxSize = config.maxFileSize;
        var maxTime = config.maxDownloadTime;
        var jobId = uuid.createUuid();
        var user = req.user;

        var tmpFiles = [];

        function downloadImage(uri) {
            var url = parseURL(uri);
            var currentDownload = null;
            var timer = new PromiseTimer(maxTime);

            if (!(/https?:/).test(url.protocol)) {
                log.warn('[%1] "%2" is not a valid URI. Aborting.', req.uuid, uri);

                return q.reject(new ServiceResponse(
                    400,
                    '"' + uri + '" is not a valid URI.'
                ));
            }

            var checkContentLength = timer.wrap(function checkContentLength(uri) {
                var headUri = request.head({
                    uri: uri,
                    resolveWithFullResponse: true
                });

                currentDownload = headUri;

                function check(response) {
                    var size = parseInt(response.headers['content-length']);

                    log.info(
                        '[%1] Content-Length of "%2" is "%3." (maxFileSize is %4.)',
                        req.uuid, uri, response.headers['content-length'], maxSize
                    );

                    if (size > maxSize) {
                        log.warn(
                            '[%1] File [%2] has a content-length of %3 which exceeds the ' +
                                'maxFileSize of %4. Not uploading.',
                            req.uuid, uri, size, maxSize
                        );

                        return q.reject(new ServiceResponse(
                            413,
                            'File [' + uri + '] is too large (' + size + ' bytes.)'
                        ));
                    }

                    return q(uri);
                }

                function ignore() {
                    log.info('[%1] Failed to HEAD uri [%2]. Proceeding.', req.uuid, uri);

                    return uri;
                }

                log.info('[%1] HEADing URI [%2].', req.uuid, uri);

                return headUri.then(check, ignore);
            });

            var fetchImage = timer.wrap(function fetchImage(uri) {
                var tmpPath = path.join(require('os').tmpdir(), jobId + path.extname(uri));
                var deferred = q.defer();

                var totalSize = 0;

                var transfer = request.get(uri);

                currentDownload = transfer;

                log.info(
                    '[%1] GETting uri [%2] and writing contents to a tmp file [%3].',
                    req.uuid, uri, tmpPath
                );

                transfer.on('data', function(data) {
                    totalSize += data.length;

                    log.trace(
                        '[%1] Downloaded %2 bytes of data. Total downloaded: %3 bytes.',
                        req.uuid, data.length, totalSize
                    );

                    if (totalSize > maxSize) {
                        transfer.abort();

                        deferred.reject(new ServiceResponse(
                            413,
                            'File [' + uri + '] is too large.'
                        ));

                        log.warn(
                            '[%1] Discovered file [%2] exceeds the maxFileSize of %3 during ' +
                                'download. Aborting.',
                            req.uuid, uri, maxSize
                        );
                    }
                });
                transfer.on('end', function() {
                    log.info(
                        '[%1] Done downloading file [%2].',
                        req.uuid, uri
                    );

                    if (/^2/.test(transfer.response.statusCode)) {
                        deferred.resolve({
                            uri: uri,
                            path: tmpPath
                        });
                    }
                });
                transfer.catch(function(data) {
                    log.warn(
                        '[%1] Failed to GET "%2." Server responded with [%3]: %4.',
                        req.uuid, uri, data.response.statusCode, data.error
                    );

                    deferred.reject(new ServiceResponse(
                        400,
                        'Could not fetch image from "' + uri + '."'
                    ));
                });

                transfer.pipe(fs.createWriteStream(tmpPath));
                tmpFiles.push(tmpPath);

                return deferred.promise;
            });

            function handleRejection(reason) {
                if (reason.code === 'ETIMEDOUT') {
                    currentDownload.abort();

                    log.warn('[%1] Timed out downloading "%2."', req.uuid, uri);

                    return q.reject(new ServiceResponse(
                        408,
                        'Timed out downloading file [' + uri + '].'
                    ));
                }

                return q.reject(reason);
            }

            return checkContentLength(uri).then(fetchImage)
                .catch(handleRejection);
        }

        function checkFileType(data) {
            var path = data.path;
            var uri = data.uri;

            function validateType(type) {
                if (!type) {
                    log.warn('[%1] File [%2] is not an image', req.uuid, uri);

                    return q.reject(new ServiceResponse(
                        415,
                        'File [' + uri + '] is not an image.'
                    ));
                }

                log.info('[%1] File [%2] is an %3.', req.uuid, uri, type);

                return {
                    path: data.path,
                    uri: data.uri,
                    type: type
                };
            }

            log.info(
                '[%1] Checking to make sure file [%2] is an image.',
                req.uuid, uri
            );

            return collateral.checkImageType(path).then(validateType);

        }

        function uploadImage(data) {
            var imagePath = data.path;
            var type = data.type;
            var uri = data.uri;
            var prefix = path.join(config.s3.path, 'userFiles', user.id);
            var image = { path: imagePath, type: type };

            function succeed(response) {
                log.info(
                    '[%1] Successfully uploaded file [%2] onto S3 as "%3."',
                    req.uuid, uri, response.key
                );

                return new ServiceResponse(201, { path: response.key });
            }

            function fail(error) {
                log.error(
                    '[%1] Failed to upload file [%2] into folder [%3]. %4',
                    req.uuid, uri, prefix, util.inspect(error)
                );

                return q.reject(new ServiceResponse(
                    500,
                    'Could not upload file [' + uri + '].'
                ));
            }

            log.info(
                '[%1] Uploading file [%2] into folder [%3].',
                req.uuid, uri, prefix
            );

            return collateral.upload(req, prefix, image, s3, config)
                .then(succeed, fail);
        }

        function cleanup() {
            function handleError(error) {
                if (error) {
                    log.warn('[%1] Error removing tmp file: %2', req.uuid, error);
                }
            }

            return tmpFiles.forEach(function(path) {
                log.info('[%1] Removing tmp file [%2].', req.uuid, path);

                fs.remove(path, handleError);
            });
        }

        function handleError(error) {
            if (error instanceof ServiceResponse) {
                return error;
            }

            log.error(
                '[%1] Unexpcted error re-uploading image URI: %2.',
                req.uuid, util.inspect(error)
            );

            return q.reject(error);
        }

        if (!req.body.uri) {
            log.warn('[%1] Client did not specify a URI to upload!', req.uuid);

            return q(new ServiceResponse(400, 'No image URI specified.'));
        }

        return downloadImage(req.body.uri)
            .then(checkFileType)
            .then(uploadImage)
            .finally(cleanup)
            .catch(handleError);
    };
    
    // If num > 6 return 6, else return num
    collateral.chooseTemplateNum = function(num) {
        return Math.min(num, 6);
    };
    
    // Cache md5's of splash images based on their imgSpec, thumbs, and template file
    collateral.splashCache = {};
    
    // Clear out all cached md5s that are older than config.splash.cacheTTL
    collateral.clearOldCachedMD5s = function(config) {
        var keys = Object.keys(collateral.splashCache),
            maxDate = new Date(new Date() - config.splash.cacheTTL),
            toDelete = 0,
            i = 0,
            log = logger.getLog();
        log.trace('Clearing old cached md5s; starting with %1 items in cache', keys.length);
        
        if (keys.length > config.splash.maxCacheKeys) {
            log.info('Too many keys in the splashCache');
            toDelete = keys.length - config.splash.maxCacheKeys;
        }
        
        keys = keys.sort(function(a, b) {
            return collateral.splashCache[a].date - collateral.splashCache[b].date;
        });
        
        while (i < keys.length && (collateral.splashCache[keys[i]].date < maxDate || toDelete > 0)){
            delete collateral.splashCache[keys[i]];
            i++;
            toDelete--;
        }
        
        log.trace('Finished clearing old cached md5s; now have %1 items in cache',
                  Object.keys(collateral.splashCache).length);
    };
    
    
    // Handles generating and uploading a splash image
    collateral.generate = function(req, imgSpec, template, cacheKey, s3, config) {
        var log             = logger.getLog(),
            jobId           = uuid.createUuid(),
            compiledPath    = path.join(require('os').tmpdir(), jobId + '-compiled.html'),
            splashPath      = path.join(require('os').tmpdir(), jobId + '-splash.jpg'),
            prefix          = path.join(config.s3.path, 'userFiles/' + req.user.id),
            data            = { thumbs: req.body.thumbs },
            compiled        = handlebars.compile(template)(data), // Compile the template
            deferred        = q.defer(),
            ph, page;

        // Phantom callbacks only callback with one arg, so we need to transform to Nodejs style
        function phantWrap(object, method, args, cb) {
            args.push(function(result) { cb(null, result); });
            object[method].apply(object, args);
        }
            
        log.info('[%1] Generating image at %2x%3 with ratio %4',
                 req.uuid, imgSpec.width, imgSpec.height, imgSpec.ratio);
        
        // Start by writing the compiled template to a file
        q.npost(fs, 'writeFile', [compiledPath, compiled])
        .then(function() { // Start setting up phantomjs
            log.trace('[%1] Wrote compiled html, starting phantom', req.uuid);
            function onExit(code, signal) {
                if (code === 0) {
                    return;
                }
                log.error('[%1] Phantom exited with code %2, signal %3',req.uuid,code,signal);
                // throw new Error('PhantomJS exited prematurely');
                deferred.reject('PhantomJS exited prematurely');
            }

            // this copies the default onStderr but replaces their console.warn with our log
            function onErr(data) {
                if (data.match(/(No such method.*socketSentData)|(CoreText performance note)/)){
                    return;
                }
                log.warn('[%1] Phantom had an error: %2', req.uuid, data);
            }

            return q.nfapply(phantWrap, [phantom, 'create', [
                '--ssl-protocol=tlsv1', // phantom defaults to SSLv3, which is insecure
                { onExit: onExit, onStderr: onErr }
            ]]);
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
                path: splashPath,
                type: 'image/jpeg'
            };
            return collateral.upload(req, prefix, fileOpts, s3, config);
        })
        
        .then(function(response) {
            log.info('[%1] File has been uploaded successfully, md5 = %2',
                     req.uuid, response.md5);

            collateral.splashCache[cacheKey] = { date: new Date(), md5: response.md5 };

            deferred.resolve(response.key);
        })
        
        .catch(function(error) {
            deferred.reject(error);
        });
        
        return deferred.promise
        .timeout(config.splash.timeout)
        .finally(function() { // Cleanup by removing compiled template + splash image
            if (page) {
                page.close();
            }
            if (ph) {
                ph.exit();
            }
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
    };

    
    // Create a single splash if needed using the imgSpec and req.body.thumbs
    //  TODO: throttle # of concurrent splashes, maybe just throttle # of concurrent phantoms
    collateral.generateSplash = function(req, imgSpec, s3, config) {
        var log             = logger.getLog(),
            user            = req.user,
            prefix          = path.join(config.s3.path, 'userFiles/' + user.id),
            templateNum     = collateral.chooseTemplateNum(req.body.thumbs.length),
            templateDir     = path.join(__dirname, '../templates/splashTemplates'),
            templatePath    = path.join(templateDir, imgSpec.ratio + '_x' + templateNum + '.html');

        function resolveObj(code, path) {
            return {
                ratio: imgSpec && imgSpec.ratio || '',
                code: code,
                path: path
            };
        }
        function rejectObj(code, error) {
            return {
                ratio: imgSpec && imgSpec.ratio || '',
                code: code,
                error: error
            };
        }

        if (!imgSpec || !imgSpec.width || !imgSpec.height || !imgSpec.ratio) {
            log.info('[%1] Incomplete imgSpec for: %2',
                     req.uuid, JSON.stringify(imgSpec));
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

        // Start by reading our template file
        return q.npost(fs, 'readFile', [templatePath, {encoding: 'utf8'}])
        .then(function(template) {
            // Hash the specs for this splash, and check if we cached the resulting md5
            var splashSpec = {
                expId   : req.params.expId,
                thumbs  : req.body.thumbs,
                height  : imgSpec.height,
                width   : imgSpec.width,
                ratio   : imgSpec.ratio,
                templ   : template
            }, md5, cacheKey;
            cacheKey = uuid.hashText(JSON.stringify(splashSpec));
            md5 = collateral.splashCache[cacheKey] && collateral.splashCache[cacheKey].md5;
            log.trace('[%1] Splash image hashes to %2', req.uuid, cacheKey);
            
            // If cached md5, check for matching file on S3; if it exists, skip generation
            if (!md5) {
                return collateral.generate(req, imgSpec, template, cacheKey, s3, config);
            }
            log.trace('[%1] Have cached md5 %2', req.uuid, md5);
            var headParams = {
                Bucket: config.s3.bucket,
                Key: path.join(prefix, md5 + '.jpg')
            };

            return q.npost(s3, 'headObject', [headParams])
            .then(function(data) {
                if (data && data.ETag && data.ETag.replace(/"/g, '') === md5) {
                    log.info('[%1] Splash image %2 already exists with cached md5 %3',
                             req.uuid, headParams.Key, md5);
                    return q(headParams.Key);
                } else {
                    log.info('[%1] Splash image %2 exists with md5 %3 instead of cached val %4',
                             req.uuid, headParams.Key, data && data.ETag, md5);
                    return collateral.generate(req, imgSpec, template, cacheKey, s3, config);
                }
            }, function(/*error*/) {
                log.info('[%1] No splash image %2 with cached md5 %3',req.uuid,headParams.Key,md5);
                return collateral.generate(req, imgSpec, template, cacheKey, s3, config);
            });
        })
        .then(function(key) {
            return q(resolveObj(201, key));
        })
        .catch(function(error) {
            log.error('[%1] Error generating splash image: %2', req.uuid, util.inspect(error));
            return q.reject(rejectObj(500, error));
        });
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
                 
        // default urls to http so phantom will handle properly
        req.body.thumbs = req.body.thumbs.map(function(thumb) {
            if (thumb.match(/^\/\/.*/)) {
                return 'http:' + thumb;
            }
            return thumb;
        });
        
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


    // Set headers for an existing file on S3; currently just handles CacheControl
    collateral.setHeaders = function(req, s3, config) {
        var log = logger.getLog(),
            deferred = q.defer(),
            cacheControl = req.body && req.body['max-age'] !== undefined ?
                           'max-age=' + req.body['max-age'] : config.cacheControl.default;
        
        if (!req.body || !req.body.path) {
            log.info('[%1] No path in request body', req.uuid);
            return q({code: 400, body: 'Must provide path of file on s3'});
        }
        
        log.info('[%1] User %2 setting CacheControl of %3 to %4',
                 req.uuid, req.user.id, req.body.path, cacheControl);

        // Best way to set headers on existing object is to copy the object to same location
        var params = {
            Bucket              : config.s3.bucket,
            CacheControl        : cacheControl,
            CopySource          : path.join(config.s3.bucket, req.body.path),
            MetadataDirective   : 'REPLACE',
            Key                 : req.body.path,
            ACL                 : 'public-read'
        };
        
        s3.headObject({Bucket: params.Bucket, Key: params.Key}, function(error, data) {
            if (error || !data || !data.ContentType) {
                log.info('[%1] Object %2 not found on s3', req.uuid, req.body.path);
                return deferred.resolve({code: 404, body: 'File not found'});
            }
            params.ContentType = data.ContentType;
            q.npost(s3, 'copyObject', [params])
            .then(function(/*resp*/) {
                log.info('[%1] Successfully set headers on %2', req.uuid, req.body.path);
                deferred.resolve({code: 200, body: req.body.path});
            }).catch(function(error) {
                log.error('[%1] Error setting headers on %2: %3',
                          req.uuid, req.body.path, util.inspect(error));
                deferred.reject(error);
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
            
        var app          = express(),
            jobManager   = new JobManager(state.cache, state.config.jobTimeouts),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._db = state.dbs.c6Db;
        
        // If running locally, you need to put AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in env
        aws.config.region = state.config.s3.region;
        s3 = new aws.S3();

        var sessionOpts = {
            key: state.config.sessions.key,
            resave: false,
            secret: state.secrets.cookieParser || '',
            cookie: {
                httpOnly: true,
                secure: state.config.sessions.secure,
                maxAge: state.config.sessions.minAge
            },
            store: state.sessionStore
        };
        
        var sessions = sessionLib(sessionOpts);

        app.set('trust proxy', 1);
        app.set('json spaces', 2);

        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessWrap(req, res, next) {
            sessions(req, res, next);
        }
        var audit = auditJournal.middleware.bind(auditJournal);
        
        var multipart = multer({ // only use multipart parser for endpoints that need it
            limits: {
                fileSize: state.config.maxFileSize,
                files: state.config.maxFiles
            }
        });

        state.dbStatus.c6Db.on('reconnected', function() {
            authUtils._db = state.dbs.c6Db;
            log.info('Recreated collections from restarted c6Db');
        });
        
        state.dbStatus.sessions.on('reconnected', function() {
            sessionOpts.store = state.sessionStore;
            sessions = sessionLib(sessionOpts);
            log.info('Recreated session store from restarted db');
        });

        state.dbStatus.c6Journal.on('reconnected', function() {
            auditJournal.resetColl(state.dbs.c6Journal.collection('audit'));
            log.info('Reset journal\'s collection from restarted db');
        });


        app.use(function(req, res, next) {
            res.header('Access-Control-Allow-Headers',
                       'Origin, X-Requested-With, Content-Type, Accept');
            res.header('cache-control', 'max-age=0');

            if (req.method.toLowerCase() === 'options') {
                res.send(200);
            } else {
                next();
            }
        });

        app.use(function(req, res, next) {
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

        app.use(bodyParser.json());
        
        var authUpload = authUtils.middlewarify({});
        var setJobTimeout = jobManager.setJobTimeout.bind(jobManager);

        app.post('/api/collateral/files/:expId', setJobTimeout, sessWrap, authUpload, multipart,
            audit, function(req,res){
                var promise = collateral.uploadFiles(req, s3, state.config);

                promise.finally(function() {
                    return jobManager.endJob(req, res, promise.inspect())
                        .catch(function(error) {
                            res.send(500, {
                                error: 'Error uploading files',
                                detail: error
                            });
                        });
                });
            }
        );
        
        app.post('/api/collateral/files', setJobTimeout, sessWrap, authUpload, multipart, audit,
            function(req, res) {
                var promise = collateral.uploadFiles(req, s3, state.config);

                promise.finally(function() {
                    return jobManager.endJob(req, res, promise.inspect())
                        .catch(function(error) {
                            res.send(500, {
                                error: 'Error uploading files',
                                detail: error
                            });
                        });
                });
            }
        );

        app.post('/api/collateral/uri', setJobTimeout, sessWrap, authUpload, audit,
            function(req, res) {
                var promise = q.when(collateral.importFile(req, s3, state.config));

                promise.finally(function() {
                    return jobManager.endJob(req, res, promise.inspect())
                        .catch(function(error) {
                            res.send(500, {
                                error: 'Error uploading files',
                                detail: error
                            });
                        });
                });
            }
        );

        app.post('/api/collateral/splash/:expId', setJobTimeout, sessWrap, authUpload, audit,
            function(req, res) {
                var promise = collateral.createSplashes(req, s3, state.config);

                promise.finally(function() {
                    return jobManager.endJob(req, res, promise.inspect())
                        .catch(function(error) {
                            res.send(500, {
                                error: 'Error uploading files',
                                detail: error
                            });
                        });
                });
            }
        );

        app.post('/api/collateral/splash', setJobTimeout, sessWrap, authUpload, audit,
            function(req, res) {
                var promise = collateral.createSplashes(req, s3, state.config);

                promise.finally(function() {
                    return jobManager.endJob(req, res, promise.inspect())
                        .catch(function(error) {
                            res.send(500, {
                                error: 'Error uploading files',
                                detail: error
                            });
                        });
                });
            }
        );

        app.post('/api/collateral/setHeaders', sessWrap, authUpload, audit, function(req, res) {
            collateral.setHeaders(req, s3, state.config)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error setting headers',
                    detail: error
                });
            });
        });

        app.get('/api/collateral/job/:id', function(req, res) {
            jobManager.getJobResult(req, res, req.params.id).catch(function(error) {
                res.send(500, { error: 'Internal error', detail: error });
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
                if (err.status && err.status < 500) {
                    log.warn('[%1] Bad Request: %2', req.uuid, err && err.message || err);
                    res.send(err.status, err.message || 'Bad Request');
                } else {
                    log.error('[%1] Internal Error: %2', req.uuid, err && err.message || err);
                    res.send(err.status || 500, err.message || 'Internal error');
                }
            } else {
                next();
            }
        });
        
        setInterval(collateral.clearOldCachedMD5s, state.config.splash.clearInterval, state.config);
        
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
        .then(service.initPubSubChannels)
        .then(service.initCache)
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
