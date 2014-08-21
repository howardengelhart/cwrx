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
        util            = require('util'),
        
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
            engineId: '007281538304941793863:cbx8mzslyne',
            fields: 'queries,items(title,link,displayLink,pagemap(videoobject(description,' +
                    'duration,height,thumbnailurl),cse_thumbnail))'
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
    
    // Parse a duration string and return the total number of seconds
    search.parseDuration = function(duration, link) {
        var log = logger.getLog();
        
        if (!duration) {
            log.warn('Video %1 has no duration', link);
            return undefined;
        }

        duration = duration.trim();

        // expect durs to look like 'PT1H1M1S', except some vimeo vids have durs like '90 mins'
        if (duration.match(/^\d+ mins/)) {
            return Number(duration.match(/^\d+/)[0])*60;
        } else if(!duration.match(/^PT(\d+H)?(\d+M)?(\d+S)?$/)) {
            log.warn('Video %1 has unknown duration format %2', link, duration);
            return undefined; // are we sure about all the log.warns?
        }
        
        return 60*60*Number((duration.match(/\d+(?=H)/) || [])[0] || 0) + // hours
                  60*Number((duration.match(/\d+(?=M)/) || [])[0] || 0) + // minutes
                     Number((duration.match(/\d+(?=S)/) || [])[0] || 0);  // seconds
    };
    
    search.formatGoogleResults = function(stats, items) {
        var log = logger.getLog();
        var respObj = {
            meta: {
                skipped         : stats.startIndex - 1,
                numResults      : stats.count,
                totalResults    : stats.totalResults
            }
        };

        respObj.items = items.map(function(item) {
            if (!item.pagemap || !item.pagemap.videoobject instanceof Array || !item.link) {
                log.warn('Invalid item: ' + JSON.stringify(item));
                return undefined; //TODO: will this work?
            }

            /*jshint camelcase: false */
            var formatted = {
                title       : item.title,
                link        : item.link,
                siteLink    : item.displayLink,
                description : item.pagemap.videoobject[0].description,
                thumbnail   : item.pagemap.cse_thumbnail && item.pagemap.cse_thumbnail[0] ||
                              { src: item.pagemap.videoobject[0].thumbnailurl },
                site        : (item.displayLink || '').replace('www.', '').replace('.com', ''),
                hd          : item.pagemap.videoobject[0].height >= 720,
                duration    : search.parseDuration(item.pagemap.videoobject[0].duration, item.link)
            };
            /*jshint camelcase: true */
            
            switch (formatted.site) {
                case 'youtube':
                    formatted.videoId = (item.link.match(/[^\=]+$/) || [])[0];
                    break;
                case 'vimeo':
                    formatted.videoId = (item.link.match(/[^\/]+$/) || [])[0];
                    break;
                case 'dailymotion':
                    formatted.videoId = (item.link.match(/[^\/_]+(?=_)/) || [])[0];
                    break;
            }
            
            return formatted;
        }).filter(function(item) {
            return !!item;
        });
        
        return respObj;
    };
    
    //TODO: comment all these funcs
    search.findVideosWithGoogle = function(req, opts, googleCfg, apiKey) {
        var log = logger.getLog();

        if (opts.sites) { //TODO: may need to change this back to single (non-array) site
            opts.query += ' site:' + opts.sites.join(' OR site:');
        }

        var reqOpts = {
            url: googleCfg.apiUrl,
            qs: {
                q       : opts.query,
                cx      : googleCfg.engineId,
                key     : apiKey,
                num     : opts.limit,
                start   : opts.start,
                fields  : googleCfg.fields
            },
            headers : {
                'Referer' : 'https://portal.cinema6.com/index.html'
            }
        };
        
        if (opts.hd) {
            reqOpts.qs.sort = 'videoobject-height:r:720';
        }
                 
        return requestUtils.qRequest('get', reqOpts)
        .then(function(resp) {
            if (resp.response.statusCode < 200 || resp.response.statusCode >= 300) {
                log.warn('[%1] Received error response from google: code %2, body = %3',
                         req.uuid, resp.response.statusCode, util.inspect(resp.body));
                return q({code: 500, body: 'Error querying google'}); //TODO: or more transparent?
            } else if (!resp.body.queries || !resp.body.queries.request || !resp.body.items) {
                log.warn('[%1] Received incomplete response body from google: %2',
                         req.uuid, util.inspect(resp.body));
                return q({code: 500, body: 'Error querying google'}); //TODO: or more transparent?
            }
            
            var stats = resp.body.queries.request[0];
            log.info('[%1] Received %2 results from %3 total results, starting at %4',
                    req.uuid, stats.count, stats.totalResults, stats.startIndex);

            return q({code: 200, body: search.formatGoogleResults(stats, resp.body.items)});
        });

    };
    
    search.findVideos = function(req, config, secrets) {
        var log = logger.getLog(),
            query = req.query && req.query.query || null,
            limit = Math.min(Math.max(parseInt(req.query && req.query.limit) || 10, 1), 10),
            start = Math.max(parseInt(req.query && req.query.skip) || 0, 0) + 1,
            sites = req.query && req.query.sites && req.query.sites.split(',') || null,
            hd = req.query && req.query.hd || false,
            opts = { query: query, limit: limit, start: start, sites: sites, hd: hd };
        
        if (!query) {
            log.info('[%1] No query in request', req.uuid);
            return q({code: 400, body: 'No query in request'});
        }
        
        log.info('[%1] User %2 is searching for %3 videos %4with query: %5; starting at result %6',
                 req.uuid, req.user.id, limit, sites ? 'from ' + sites.join(',') + ' ' : '',
                 query, start);
                 
        return search.findVideosWithGoogle(req, opts, config.google, secrets.googleKey)
        .catch(function(error) {
            log.error('[%1] Error searching videos: %2', req.uuid, util.inspect(error));
            return q.reject(error);
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
            search.findVideos(req, state.config, state.secrets)
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
