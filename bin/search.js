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
        util            = require('util'),

        state   = {},
        search  = {}; // for exporting functions to unit tests

    // This is the template for search's configuration
    state.defaultConfig = {
        appName: 'search',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/search/caches/run/'),
        },
        google: {
            apiUrl: 'https://www.googleapis.com/customsearch/v1',
            engineId: '007281538304941793863:cbx8mzslyne',
            fields: 'queries,items(title,link,snippet,displayLink,' +
                    'pagemap(videoobject,cse_thumbnail))',
            retryTimeout: 1000 // milliseconds to wait before retrying a failed request to Google
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
        secretsPath: path.join(process.env.HOME,'.search.secrets.json'),
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
        }
    };

    // Parse a duration string and return the total number of seconds
    search.parseDuration = function(dur, link) {
        var log = logger.getLog(),
            isYahoo = false,
            timeParts = [ // for parsing duration strings in ISO 8601 format; years thru seconds
                { rgx: /(\d+\.?\d*)Y/,        yrgx: /Y(\d+\.?\d*)/,        factor: 365*24*60*60 },
                { rgx: /P[^T]*?(\d+\.?\d*)M/, yrgx: /P[^T]*?M(\d+\.?\d*)/, factor: 30*24*60*60 },
                { rgx: /(\d+\.?\d*)D/,        yrgx: /D(\d+\.?\d*)/,        factor: 24*60*60 },
                { rgx: /(\d+\.?\d*)H/,        yrgx: /H(\d+\.?\d*)/,        factor: 60*60 },
                { rgx: /T.*?(\d+\.?\d*)M/,    yrgx: /T.*?M(\d+\.?\d*)/,    factor: 60 },
                { rgx: /(\d+\.?\d*)S/,        yrgx: /S(\d+\.?\d*)/,        factor: 1 },
            ];

        if (!dur) {
            log.info('Video %1 has no duration', link); // AOL vids have no duration, for example
            return undefined;
        }

        dur = dur.trim();

        // some vimeo vids have durs like '90 mins' or '1 hour 20 minutes'
        if (dur.match(/^(\d+ (years?|months?|days?|hours?|minutes?|mins?|seconds?)\s?)+$/)) {
            return Number( ( dur.match(/(\d+) years?/) || [0, 0] )[1] )*365*24*60*60 +
                   Number( ( dur.match(/(\d+) months?/) || [0, 0] )[1] )*30*24*60*60 +
                   Number( ( dur.match(/(\d+) days?/) || [0, 0] )[1] )*24*60*60 +
                   Number( ( dur.match(/(\d+) hours?/) || [0, 0] )[1] )*60*60 +
                   Number( ( dur.match(/(\d+) (mins|minutes)/) || [0, 0] )[1] )*60 +
                   Number( ( dur.match(/(\d+) seconds?/) || [0, 0] )[1] );
        }

        // Yahoo incorrectly implements ISO 8601 duration format, so need different regexes
        if (dur.match(/^P([Y,M,D]\d+\.?\d*)*T?([H,M,S]\d+\.?\d*)*$/)) {
            isYahoo = true;
        } else if (!dur.match(/^P?(\d+\.?\d*[Y,M,D])*T?(\d+\.?\d*[H,M,S])*$/)) {
            log.warn('Video %1 has unknown duration format %2', link, dur);
            return undefined;
        }

        // Ensure the duration format starts with P (rumble doesn't always do this)
        if(dur[0] !== 'P') {
            dur = 'P' + dur;
        }

        return timeParts.reduce(function(total, part) {
            var regex = isYahoo ? part.yrgx : part.rgx;
            return total += part.factor * Number( ( dur.match(regex) || [0, 0] )[1] );
        }, 0);
    };

    // Properly format results returned from findVideosWithGoogle
    search.formatGoogleResults = function(stats, items) {
        var log = logger.getLog();
        var respObj = {
            meta: {
                skipped         : Math.max(stats.startIndex - 1, 0),
                numResults      : stats.count,
                totalResults    : stats.totalResults
            }
        };

        items = items || [];

        respObj.items = items.map(function(item) {
            if (!item.pagemap || !item.pagemap.videoobject instanceof Array || !item.link) {
                log.warn('Invalid item: ' + JSON.stringify(item));
                return undefined;
            }

            /*jshint camelcase: false */
            var formatted = {
                title       : item.title,
                link        : item.link,
                siteLink    : item.displayLink,
                description : item.pagemap.videoobject[0].description || item.snippet,
                thumbnail   : item.pagemap.cse_thumbnail && item.pagemap.cse_thumbnail[0] ||
                              { src: item.pagemap.videoobject[0].thumbnailurl },
                site        : (item.displayLink || '').replace(/(www|m)\./, '').replace('.com', ''),
                hd          : item.pagemap.videoobject[0].height >= 720,
                duration    : search.parseDuration(item.pagemap.videoobject[0].duration, item.link)
            };
            /*jshint camelcase: true */

            if (formatted.site.match('aol')) { // Transform 'on.aol' to just 'aol'
                formatted.site = 'aol';
            } else if (formatted.site.match('yahoo')) { // Transform 'screen.yahoo' to just 'yahoo'
                formatted.site = 'yahoo';
            }

            switch (formatted.site) {
                case 'youtube':
                    formatted.videoid = (item.link.match(/[^\=]+$/) || [])[0];
                    break;
                case 'vimeo':
                    formatted.videoid = (item.link.match(/[^\/]+$/) || [])[0];
                    break;
                case 'dailymotion':
                    formatted.videoid = (item.link.match(/[^\/_]+(?=_)/) || [])[0];
                    break;
                case 'aol':
                    formatted.videoid = (item.link.match(/[^\/]+$/) || [])[0];
                    break;
                case 'yahoo':
                    formatted.videoid = (item.link.match(/[^\/]+(?=(\.html))/) || [])[0];
                    break;
                case 'rumble':
                    formatted.videoid = (item.link.match(/[^\/]+(?=(\.html))/) || [])[0];
                    break;
                default:
                    log.warn('Unexpected site %1, cannot set videoid', formatted.site);
                    break;
            }

            return formatted;
        }).filter(function(item) {
            return !!item;
        });

        return respObj;
    };

    // Use req params to find videos using Google's Custom Search API.
    search.findVideosWithGoogle = function(req, opts, googleCfg, apiKey) {
        var log = logger.getLog(),
            deferred = q.defer();

        if (opts.start + opts.limit > 101) {
            log.info('[%1] Cannot query for results after the first 100; start = %2, limit = %3',
                     req.uuid, opts.start, opts.limit);
            return q({code: 400, body: 'Cannot query past first 100 results'});
        }

        if (opts.sites) {
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

        if (opts.hd === 'true') {
            reqOpts.qs.sort = 'videoobject-height:r:720';
        } else if (opts.hd === 'false') {
            reqOpts.qs.sort = 'videoobject-height:r::719';
        }

        (function tryRequest(retried) {
            return requestUtils.qRequest('get', reqOpts)
            .then(function(resp) {
                if (resp.response.statusCode < 200 || resp.response.statusCode >= 300) {
                    return q.reject('Received error response from google: code ' +
                           resp.response.statusCode + ', body = ' + util.inspect(resp.body));
                } else if (!resp.body.queries || !resp.body.queries.request) {
                    return q.reject('Received incomplete response body from google: ' +
                                    util.inspect(resp.body));
                }

                var stats = resp.body.queries.request[0];
                stats.count = Math.min(stats.count, stats.totalResults);
                stats.startIndex = stats.startIndex || 0;
                stats.totalResults = Math.min(Number(stats.totalResults), 100);
                log.info('[%1] Received %2 results from %3 total results, starting at %4',
                        req.uuid, stats.count, stats.totalResults, stats.startIndex);

                deferred.resolve({
                    code: 200,
                    body: search.formatGoogleResults(stats, resp.body.items)
                });
            })
            .catch(function(error) {
                if (retried) {
                    log.warn('[%1] Second fail querying google: %2', req.uuid, util.inspect(error));
                    deferred.resolve({code: 500, body: 'Error querying google'});
                } else {
                    log.warn('[%1] Error querying google: %2', req.uuid, util.inspect(error));
                    setTimeout(function() { return tryRequest(true); }, googleCfg.retryTimeout);
                }
            });
        })();

        return deferred.promise;
    };

    // Parse request params and use 3rd party to find videos. Currently uses findVideosWithGoogle
    search.findVideos = function(req, config, secrets) {
        var log = logger.getLog(),
            query = req.query && req.query.query || null,
            limit = Math.min(Math.max(parseInt(req.query && req.query.limit) || 10, 1), 10),
            start = Math.max(parseInt(req.query && req.query.skip) || 0, 0) + 1,
            sites = req.query && req.query.sites && req.query.sites.split(',').map(
                function(site) {
                    if (site === 'yahoo') {
                        site = 'screen.' + site;
                    } else if (site === 'aol') {
                        site = 'on.' + site;
                    }
                    return site + '.com';
                }) || null,
            hd = req.query && req.query.hd || undefined,
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

        var app          = express(),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._db = state.dbs.c6Db;
        
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

        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessWrap(req, res, next) {
            sessions(req, res, next);
        }
        var audit = auditJournal.middleware.bind(auditJournal);

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

        var authSearch = authUtils.middlewarify({});
        app.get('/api/search/videos', sessWrap, authSearch, audit, function(req,res){
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
