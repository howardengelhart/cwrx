#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        q               = require('q'),
        requestUtils    = require('../lib/requestUtils'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        authUtils       = require('../lib/authUtils')(),
        service         = require('../lib/service'),
        
        state      = {},
        search = {}; // for exporting functions to unit tests

    state.name = 'search';
    // This is the template for search's configuration
    state.defaultConfig = {
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/search/caches/run/'),
        },
        cacheTTLs: {  // units here are minutes
            auth: {
                freshTTL: 1,
                maxTTL: 10
            }
        },
        google: {
            apiUrl: 'https://www.googleapis.com/customsearch/v1',
            engineId: '007281538304941793863:cbx8mzslyne',//TODO: reformat fields?
            fields: 'queries,spelling,items(title,htmlTitle,link,snippet,htmlSnippet,' +
                    'pagemap(videoobject,cse_image,cse_thumbnail))'
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
        }, //TODO: make sure secrets gets google account key in cookbook
        secretsPath: path.join(process.env.HOME,'.search.secrets.json'),
        mongo: {
            c6Db: {
                host: null,
                port: null,
                retryConnect : true
            }
        }
    };
    
    search.findVideos = function(req, googleCfg, apiKey) {
        var log = logger.getLog(),
            limit = Math.min(Math.max(parseInt(req.query && req.query.limit) || 10, 1), 10),
            start = Math.max(parseInt(req.query && req.query.skip) || 0, 0) + 1;
        
        if (!req.query || !req.query.query) {
            log.info('[%1] No query in request', req.uuid);
            return q({code: 400, body: 'No query in request'});
        }
        
        var reqOpts = {
            url: googleCfg.apiUrl,
            qs: {
                q       : req.query.query,
                cx      : googleCfg.engineId,
                key     : apiKey,
                num     : limit,
                start   : start,
                fields  : googleCfg.fields
            },
            headers : {
                'Referer' : 'https://portal.cinema6.com/index.html'
            }
        };
        
        log.info('[%1] User %2 is searching for %3 videos with query: %4; starting at result %5',
                 req.uuid, req.user.id, limit, req.query.query, start);
                 
        return requestUtils.qRequest('get', reqOpts).then(function(resp) {
            var stats = resp.body.queries.request[0];
            log.info('[%1] Received %2 results from %3 total results, starting at %4',
                    req.uuid, stats.count, stats.totalResults, stats.startIndex);
            //TODO: transform/format results?
            return q({code: resp.response.statusCode, body: resp.body.items});
        });
    };

    search.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
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
        
        var authSearch = authUtils.middlewarify({});
        app.get('/api/search/videos', sessionsWrapper, authSearch, function(req,res){
            search.findVideos(req, state.config.google, state.secrets.googleKey)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error searching for videos',
                    detail: error
                });
            });
        });
        
        app.get('/api/search/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/search/version',function(req, res) {
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
        .then(search.main)
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
        module.exports = search;
    }
}());
