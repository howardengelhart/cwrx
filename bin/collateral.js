#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path        = require('path'),
        q           = require('q'),
        aws         = require('aws-sdk'),
        fs          = require('fs-extra'),
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

        if (!req.files || Object.keys(req.files).length === 0) {
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
            var file = req.files[objName],
                outParams, headParams, fname;
                
            
            if (file.size > config.maxFileSize) {
                log.warn('[%1] File %2 is %3 bytes large, which is too big',
                         req.uuid, file.name, file.size);
                cleanup(file.path);
                return q.reject({ code: 413, name: objName, error: 'File is too big' });
            }
            
            return uuid.hashFile(file.path).then(function(hash) {
                fname = hash + '.' + file.name;
                outParams = {
                    Bucket      : config.s3.bucket,
                    Key         : path.join(config.s3.path, org, fname),
                    ACL         : 'public-read',
                    ContentType : file.type
                };
                headParams = {Key: outParams.Key, Bucket: outParams.Bucket};
                
                log.info('[%1] User %2 is uploading file to %3/%4',
                         req.uuid, req.user.id, outParams.Bucket, outParams.Key);

                return q.npost(s3, 'headObject', [headParams]).then(function(/*data*/) {
                    log.info('[%1] Identical file %2 already exists on s3, not uploading',
                             req.uuid, fname);
                    return q();
                })
                .catch(function(/*error*/) {
                    return s3util.putObject(s3, file.path, outParams);
                });
            })
            .then(function() {
                log.info('[%1] File %2 has been uploaded successfully', req.uuid, fname);
                return q({ code: 201, name: objName, path: outParams.Key });
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

        // Check that c6Db is running, recreating collections if db was restarted
        function checkC6Db(req, res, next) {
            if (state.dbStatus.c6Db === 'down') {
                log.error('[%1] c6Db is down', req.uuid);
                return res.send(500, 'Connection to db is down');
            }
            if (state.dbStatus.c6Db === 'recovered') { // recreate all collections
                users = state.dbs.c6Db.collection('users');
                authUtils._cache._coll = users;
                state.dbStatus.c6Db = 'ok';
                log.info('[%1] Recreated collections from restarted c6Db', req.uuid);
            }
            next();
        }
        
        // Check that sessions db is running, recreating if db was restarted, then call sessions
        function sessionWrapper(req, res, next) {
            if (state.dbStatus.sessions === 'down') {
                log.error('[%1] sessions is down', req.uuid);
                return res.send(500, 'Connection to db is down');
            }
            if (state.dbStatus.sessions === 'recovered') { // recreate session store
                sessions = express.session({
                    key: state.config.sessions.key,
                    cookie: {
                        httpOnly: false,
                        maxAge: state.config.sessions.minAge
                    },
                    store: state.sessionStore
                });
                state.dbStatus.sessions = 'ok';
                log.info('[%1] Recreated session store from restarted db', req.uuid);
            }
            return sessions(req, res, next);
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
        app.post('/api/collateral/files', checkC6Db, sessionWrapper, authUpload, function(req,res){
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
