#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var q               = require('q'),
    path            = require('path'),
    url             = require('url'),
    express         = require('express'),
    bodyParser      = require('body-parser'),
    sessionLib      = require('express-session'),
    pg              = require('pg.js'),
    requestUtils    = require('../lib/requestUtils'),
    dbpass          = require('../lib/dbpass'),
    logger          = require('../lib/logger'),
    uuid            = require('../lib/uuid'),
    authUtils       = require('../lib/authUtils'),
    service         = require('../lib/service'),
    state   = {},
    lib     = {};

state.defaultConfig = {
    appName: 'querybot',
    appDir: __dirname,
    caches : { //TODO: may want to rename this now...
        run     : path.normalize('/usr/local/share/cwrx/' + state.name + '/caches/run/'),
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
    secretsPath: path.join(process.env.HOME,'.querybot.secrets.json'),
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
    pg : {
        defaults : {
            poolSize        : 20,
            poolIdleTimeout : 900000
        }
    },
    cache: {
        timeouts: {},
        servers: null
    },
    api : {
        root: 'http://localhost/'
    },
    campaignCacheTTL : 120 * 1000,
    requestMaxAge : 300
};

lib.campaignCacheGet = function(key) {
    if (state.config.campaignCacheTTL > 0) {
        return state.cache.get(key);
    }
    return q();
};

lib.campaignCacheSet = function(key,val) {
    if (state.config.campaignCacheTTL > 0) {
        return state.cache.set(key,val,state.config.campaignCacheTTL);
    }
    return q();
};

lib.pgInit = function(state) {
    var lookup = dbpass.open();

    ['database','host','user'].forEach(function(key){
        if (!(!!state.config.pg.defaults[key])){
            throw new Error('Missing configuration: pg.defaults.' + key);
        } else {
            pg.defaults[key] = state.config.pg.defaults[key];
        }
    });

    ['port','poolSize','poolIdleTimeout','reapIntervalMillis'].forEach(function(key){
        if (state.config.pg.defaults[key]) {
            pg.defaults[key] = state.config.pg.defaults[key];
        }
    });

    pg.defaults.password = lookup(
        pg.defaults.host,pg.defaults.port,
        pg.defaults.database,pg.defaults.user
    );

    pg.on('error',function(e){
        var log = logger.getLog();
        log.error('pg-error: %1', e.message);
    });

    return state;
};

lib.pgQuery = function(statement,params){
    var deferred = q.defer(), log = logger.getLog();

    pg.connect(function(err, client, done) {
        if (err) {
            log.error('pg.connect error: %1',err.message);
            return deferred.reject(new Error('Internal Error'));
        }

        client.query(statement,params,function(err,result){
            done();
            if (err) {
                log.error('pg.client.query error: %1, %2, %3',
                    err.message, statement, params);
                deferred.reject(new Error('Internal Error'));
            } else {
                deferred.resolve(result);
            }
        });
    });

    return deferred.promise;
};

lib.campaignIdsFromRequest = function(req){
    var log = logger.getLog(), ids = {}, idList = '',
        urlBase = url.resolve(state.config.api.root , '/api/campaigns/');
    if (req.params.id) {
        ids[req.params.id] = 1;
    }
    else
    if (req.query.id) {
        req.query.id.split(',').forEach(function(id){
            ids[id] = 1;
        });
    }

    ids = Object.keys(ids);
    if( ids.length === 0) {
        return q.reject(new Error('At least one campaignId is required.'));
    }

    idList = ids.join(',');
    log.trace('campaign check: %1, ids=%2',urlBase , idList);
    return requestUtils.qRequest('get', {
        url: urlBase,
        headers: { cookie: req.headers.cookie },
        qs : {
            ids    : idList,
            fields : 'id'
        }
    })
    .then(function(resp){
        log.info('STATUS CODE: %1',resp.response.statusCode);
        var result = [];
        if (resp.response.statusCode === 200) {
            log.trace('campaign found: %1',resp.body.id);
            result = resp.body.map(function(item){
                return  item.id;
            });
        } else {
            log.error('Campaign Check Failed with: %1 : %2',
                resp.response.statusCode,resp.body);
        }
        return result;
    });
};

lib.getCampaignDataFromCache = function(campaignIds,keySuffix){
    var log = logger.getLog(), retval;
    return q.all(campaignIds.map(function(id){
        return lib.campaignCacheGet(id + keySuffix);
    }))
    .then(function(results){
        results.forEach(function(res){
            if ((res) && (res.campaignId)) {
                if (retval === undefined) {
                    retval = {};
                }
                log.trace('Found campaign[%1] in cache.',res.campaignId);
                retval[res.campaignId] = res;
            }
        });
        return retval;
    });
};

lib.setCampaignDataInCache = function(data,keySuffix){
    var log = logger.getLog();
    return q.all(Object.keys(data).map(function(id){
        log.trace('Store campaign[%1] in cache.',id);
        return lib.campaignCacheSet(id + keySuffix, data[id]);
    }))
    .then(function(){
        return data;
    })
    .catch(function(e){
        log.warn(e.message);
        return data;
    });
};

lib.queryCampaignDaily = function(campaignIds) {
    var idCount = campaignIds.length, statement;
    
    if (idCount < 1) {
        throw new Error('At least one campaignId is required.');
    }

    statement =
        'SELECT rec_date as "recDate", campaign_id as "campaignId", ' +
        'impressions,views,clicks, total_spend as "totalSpend" ' +
        'FROM rpt.campaign_crosstab_daily_live WHERE campaign_id = ANY($1::text[])';

    return lib.pgQuery(statement,[campaignIds])
        .then(function(result){
            var res;
            result.rows.forEach(function(row){
                if (res === undefined) {
                    res = {};
                }
                if (!res[row.campaignId]){
                    res[row.campaignId] = [];
                }
                res[row.campaignId].push(row);
            });
        });
};

lib.queryCampaignSummary = function(campaignIds) {
    var idCount = campaignIds.length, statement;
    
    if (idCount < 1) {
        throw new Error('At least one campaignId is required.');
    }

    statement =
        'SELECT campaign_id as "campaignId" ,plays as impressions,views, ' +
        '(link_action + link_facebook + link_twitter + link_website + link_youtube) as clicks, ' +
        'total_spend as "totalSpend" ' +
        'FROM rpt.campaign_crosstab_live WHERE campaign_id = ANY($1::text[])';

    return lib.pgQuery(statement,[campaignIds])
        .then(function(result){
            var res;
            result.rows.forEach(function(row){
                if (res === undefined) {
                    res = {};
                }
                res[row.campaignId] = row;
            });
            return res;
        });
};

lib.getCampaignSummaryAnalytics = function(req){

    function prepare(r){
        return lib.campaignIdsFromRequest(r)
            .then(function(ids){
                return {
                    request      : r,
                    keySuffix    : ':summary',
                    cacheResults : null,
                    queryResults : null,
                    campaignIds  : ids
                };
            });
    }

    function getDataFromCache(j){
        if (!j.campaignIds || !(j.campaignIds.length)){
            return j;
        }
        return lib.getCampaignDataFromCache(j.campaignIds,j.keySuffix)
        .then(function(res){
            j.cacheResults = res;
            if (res) {
                j.campaignIds = j.campaignIds.filter(function(id){
                    return (res[id] === undefined);
                });
            }
            return j;
        });
    }

    function getDataFromDb(j){
        if (!j.campaignIds || !(j.campaignIds.length)){
            return j;
        }
        return lib.queryCampaignSummary(j.campaignIds)
            .then(function(res){
                j.queryResults = res;
                if (!res) {
                    return j;
                }
                return lib.setCampaignDataInCache(res,j.keySuffix)
                    .then(function(){
                        return j;
                    });
            });
    }

    function fmt(id,result){
        delete result.campaignId;
        return {
            campaignId  : id,
            summary     : result
        };
    }

    function compileResults(j){
        j.request.campaignSummaryAnalytics = Array.prototype.concat(
            Object.keys(j.cacheResults || {}).map(function(id){
                return fmt(id,j.cacheResults[id]);
            }),
            Object.keys(j.queryResults || {}).map(function(id){
                return fmt(id,j.queryResults[id]);
            })
        );
        return j.request;
    }
    
    return prepare(req)
    .then(getDataFromCache)
    .then(getDataFromDb)
    .then(compileResults);
};

lib.main = function(state) {
    var log = logger.getLog(),
        started = new Date();
    if (state.clusterMaster){
        log.info('Cluster master, not a worker');
        return state;
    }
    log.info('Running as cluster worker, proceed with setting up web server.');

    var app          = express();
    
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
    app.set('json spaces', 2);
    
    // Because we may recreate the session middleware, we need to wrap it in the route handlers
//    function sessWrap(req, res, next) {
//        sessions(req, res, next);
//    }

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
        log.info('Reset journal\'s collection from restarted db');
    });


    app.use(function(req, res, next) {
        res.header('Access-Control-Allow-Headers',
                   'Origin, X-Requested-With, Content-Type, Accept');
        res.header('cache-control', 'max-age=' + state.config.requestMaxAge);

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

    app.get('/api/analytics/meta', function(req, res){
        var data = {
            version: state.config.appVersion,
            started : started.toISOString(),
            status : 'OK'
        };
        res.send(200, data);
    });

    app.get('/api/analytics/version',function(req, res) {
        res.send(200, state.config.appVersion);
    });
    
    var authAnalCamp = authUtils.middlewarify({campaigns: 'read'});
    app.get('/api/analytics/campaigns/:id', sessions, authAnalCamp, function(req, res, next) {
        lib.getCampaignSummaryAnalytics(req)
        .then(function(){
            if (req.campaignSummaryAnalytics.length === 0) {
                res.send(404);
            } else {
                res.send(200,req.campaignSummaryAnalytics[0]);
            }
            next();
        })
        .catch(function(err){
            log.error('[%1] - 500 Error: [%2]',req.uuid,err.stack);
            res.send(500);
            next();
        });
    });
    
    app.get('/api/analytics/campaigns/', sessions, authAnalCamp, function(req, res, next) {
        lib.getCampaignSummaryAnalytics(req)
        .then(function(){
            res.send(200,req.campaignSummaryAnalytics);
            next();
        })
        .catch(function(err){
            log.error('[%1] - 500 Error: [%2]',req.uuid,err.stack);
            res.send(500,err.message);
            next();
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
    .then(service.initPubSubChannels)
    .then(service.initCache)
    .then(lib.pgInit)
    .then(lib.main)
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
    lib._state = state;
    module.exports = lib;
}
