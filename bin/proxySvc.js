#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        q               = require('q'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        sessionLib      = require('express-session'),
        requestUtils    = require('../lib/requestUtils'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        authUtils       = require('../lib/authUtils'),
        journal         = require('../lib/journal'),
        service         = require('../lib/service'),

        state   = {},
        proxySvc   = {}; // for exporting functions to unit tests

    // This is the template for proxySvc's configuration
    state.defaultConfig = {
        appName: 'proxySvc',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/proxySvc/caches/run/'),
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
        secretsPath: path.join(process.env.HOME,'.proxySvc.secrets.json'),
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
        whitelists: {
            facebook: {
                endpoints: ['/v2\\.4/[\\d_]+', '/v2\\.4/[\\d_]+/(likes|comments|sharedposts)'],
                params: ['summary']
            },
            twitter: {
                endpoints: ['/1.1/statuses/show.json'],
                params: ['id']
            }
        }
    };

    proxySvc.getHost = function(uuid, service) {
        switch(service) {
        case 'facebook':
            return 'https://graph.facebook.com';
        case 'twitter':
            return 'https://api.twitter.com';
        default:
            throw new Error('Tried to get host for unrecognized service "' + service + '"');
        }
    };

    proxySvc.getAuthOptions = function(uuid, service, serviceCreds) {
        var creds;
        switch(service) {
        case 'facebook':
            creds = serviceCreds.facebookCredentials;
            return q({
                qs: {
                    /*jshint camelcase: false */
                    access_token: creds.appId + '|' + creds.appSecret
                    /*jshint camelcase: true */
                }
            });
        case 'twitter':
            creds = serviceCreds.twitterCredentials;
            var consumerKey = encodeURIComponent(creds.appId),
                consumerSecret = encodeURIComponent(creds.appSecret),
                bearerTokenCreds = consumerKey + ':' + consumerSecret,
                encodedCreds = new Buffer(bearerTokenCreds).toString('base64'),
                options = {
                    url: proxySvc.getHost(uuid, 'twitter') + '/oauth2/token',
                    headers: {
                        'Authorization': 'Basic ' + encodedCreds,
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    },
                    body: 'grant_type=client_credentials'
                };
            return requestUtils.qRequest('post', options).then(function(resp) {
                /*jshint camelcase: false */
                var tokenType = resp.body.token_type;
                var accessToken = resp.body.access_token;
                /*jshint camelcase: true */
                if(tokenType === 'bearer') {
                    return {
                        headers: {
                            'Authorization': 'Bearer ' + accessToken
                        }
                    };
                } else {
                    return q.reject('Twitter token "' + tokenType +
                        '" is not the required bearer token.');
                }
            }).catch(function(error) {
                return q.reject({
                    error:'Twitter authentication failed',
                    detail: error
                });
            });
        default:
            return q.reject('Tried to get auth options for unrecognized service "' + service + '"');
        }
    };

    proxySvc.proxy = function(req, service, serviceCreds, whitelists) {
        var log = logger.getLog();
        var endpoint = req.query && req.query.endpoint;
        if(!endpoint) {
            log.info('[%1] Required query param "endpoint" was not specified.', req.uuid);
            return q({
                code: 400,
                body: 'You must specify an endpoint as a query parameter.'
            });
        }
        var validEndpoints = whitelists[service].endpoints;
        var validEndpoint = false;
        for(var i=0;i<validEndpoints.length;i++) {
            if(endpoint.match(new RegExp('^' + validEndpoints[i] + '$'))) {
                validEndpoint = true;
                break;
            }
        }
        if(!validEndpoint) {
            log.info('[%1] The endpoint "%2" is not valid.', req.uuid, endpoint);
            return q({
                code: 403,
                body: 'The specified endpoint is invalid.'
            });
        }
        return proxySvc.getAuthOptions(req.uuid, service, serviceCreds).then(function(options) {
            if(!options.qs) {
                options.qs = { };
            }
            whitelists[service].params.forEach(function(param) {
                if(req.query[param] && !options.qs[param]) {
                    options.qs[param] = req.query[param];
                }
            });
            options.url = proxySvc.getHost(req.uuid, service) + endpoint;
            return requestUtils.qRequest('get', options);
        }).then(function(resp) {
            return {
                code: resp.response.statusCode,
                body: resp.body
            };
        }).catch(function(error) {
            log.error('[%1] %2', req.uuid, JSON.stringify(error, null, 2));
            return q.reject(error);
        });
    };

    proxySvc.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        // Ensure credentials exist
        var fbCreds = state.secrets.facebookCredentials;
        var twtrCreds = state.secrets.twitterCredentials;
        if(!fbCreds.appId || !fbCreds.appSecret || !twtrCreds.appId || !twtrCreds.appSecret) {
            return q.reject('Facebook or Twitter credentials have not been specified.');
        }

        var app          = express(),
            users        = state.dbs.c6Db.collection('users'),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._coll = users;

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

        app.set('json spaces', 2);
        app.set('trust proxy', 1);

        state.dbStatus.c6Db.on('reconnected', function() {
            users = state.dbs.c6Db.collection('users');
            authUtils._coll = users;
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

        app.get('/api/proxy/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/proxy/version', function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.get('/api/proxy/facebook', function(req, res) {
            var serviceCreds = {
                facebookCredentials: state.secrets.facebookCredentials,
                twitterCredentials: state.secrets.twitterCredentials
            };
            proxySvc.proxy(req, 'facebook', serviceCreds, state.config.whitelists)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'There was a problem proxying the request to Facebook.',
                    detail: error
                });
            });
        });

        app.get('/api/proxy/twitter', function(req, res) {
            var serviceCreds = {
                facebookCredentials: state.secrets.facebookCredentials,
                twitterCredentials: state.secrets.twitterCredentials
            };
            proxySvc.proxy(req, 'twitter', serviceCreds, state.config.whitelists)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'There was a problem proxying the request to Twitter.',
                    detail: error
                });
            });
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
        .then(proxySvc.main)
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
        module.exports.proxySvc = proxySvc;
        module.exports.state = state;
    }
}());
