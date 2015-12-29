#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var q               = require('q'),
    path            = require('path'),
    url             = require('url'),
    express         = require('express'),
    bodyParser      = require('body-parser'),
    pg              = require('pg.js'),
    inherits        = require('util').inherits,
    expressUtils    = require('../lib/expressUtils'),
    requestUtils    = require('../lib/requestUtils'),
    dbpass          = require('../lib/dbpass'),
    logger          = require('../lib/logger'),
    authUtils       = require('../lib/authUtils'),
    service         = require('../lib/service'),
    state   = {},
    lib     = {};

function ServiceError(message, status) {
    Error.call(this, message);

    this.message = message;
    this.status = status;
}
inherits(ServiceError, Error);

ServiceError.prototype.toString = function toString() {
    return '[' + this.status + '] ' + this.message;
};

state.defaultConfig = {
    appName: 'querybot',
    appDir: __dirname,
    caches : { //TODO: may want to rename this now...
        run     : path.normalize('/usr/local/share/cwrx/' + state.name + '/caches/run/'),
    },
    sessions: {
        key: 'c6Auth',
        maxAge: 30*60*1000,         // 30 minutes; unit here is milliseconds
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
            return deferred.reject(new ServiceError('Internal Error',500));
        }

        client.query(statement,params,function(err,result){
            done();
            if (err) {
                log.error('pg.client.query error: %1, %2, %3',
                    err.message, statement, params);
                deferred.reject(new ServiceError('Internal Error',500));
            } else {
                deferred.resolve(result);
            }
        });
    });

    return deferred.promise;
};

lib.campaignIdsFromRequest = function(req){
    var log = logger.getLog(), ids = {}, idList = '',
        urlBase = url.resolve(state.config.api.root , '/api/campaigns/') ;
    if (req.params.id) {
        ids[req.params.id] = 1;
    }
    else
    if (req.query.ids) {
        req.query.ids.split(',').forEach(function(id){
            ids[id] = 1;
        });
    }

    ids = Object.keys(ids);
    if( ids.length === 0) {
        return q.reject(new ServiceError('At least one campaignId is required.', 400));
    }

    idList = ids.join(',');
    log.trace('[%1] campaign check: %2, ids=%3', req.uuid,urlBase , idList);
    return requestUtils.qRequest('get', {
        url: urlBase,
        headers: { cookie: req.headers.cookie },
        qs : {
            ids    : idList,
            fields : 'id'
        }
    })
    .then(function(resp){
        log.trace('[%1] STATUS CODE: %2',req.uuid,resp.response.statusCode);
        var result = [];
        if (resp.response.statusCode === 200) {
            log.trace('[%1] campaign found: %2',req.uuid,resp.response.body);
            result = resp.body.map(function(item){
                return  item.id;
            });
        } else {
            log.error('[%1] Campaign Check Failed with: %2 : %3',
                req.uuid,resp.response.statusCode,resp.body);
        }
        return result;
    });
};

lib.getCampaignDataFromCache = function(campaignIds,keySuffix){
    var log = logger.getLog(), retval;
    return q.all(campaignIds.map(function(id){
        return lib.campaignCacheGet(id + keySuffix).catch(function(e){
            log.warn('Cache error: Key=%1, Error=%2', id + keySuffix, e.message);
            return null;
        });
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

lib.processCampaignSummaryRecord = function(record, obj) {
    var m, eventCount = parseInt(record.eventCount,10);
    if (isNaN(eventCount)){
        eventCount = 0;
    }
    if (!obj) {
        obj = {
            campaignId : record.campaignId,
            summary : {
                impressions : 0,
                views       : 0,
                totalSpend  : '0.0000',
                linkClicks  : {},
                shareClicks : {}
            }
        };
    }
    
    if (record.eventType === 'cardView') {
        obj.summary.impressions = eventCount;
    } else
    if (record.eventType === 'completedView') {
        obj.summary.views       = eventCount;
        obj.summary.totalSpend   = record.eventCost;
    } else  {
        m = record.eventType.match(/shareLink\.(.*)/);
        if (m) {
            obj.summary.shareClicks[m[1].toLowerCase()] = eventCount;
        } else {
            m = record.eventType.match(/link\.(.*)/);
            if (m) {
                obj.summary.linkClicks[m[1].toLowerCase()] = eventCount;
            }
        }
    }

    return obj;
};

lib.queryCampaignSummary = function(campaignIds) {
    var  statement =
        'select campaign_id as "campaignId" ,event_type as "eventType",' +
        'sum(events) as "eventCount", sum(event_cost) as "eventCost"' +
        ' from rpt.campaign_summary_hourly_all' +
        ' where campaign_id = ANY($1::text[]) ' +
        ' and NOT event_type = ANY($2::text[]) ' +
        ' group by campaign_id,event_type' +
        ' order by campaign_id,event_type';

    return lib.pgQuery(statement,[campaignIds,['q1','q2','q3','q4','launch','load','play']])
        .then(function(result){
            var res ;
            result.rows.forEach(function(row){
                if (res === undefined) {
                    res = {};
                }
                res[row.campaignId] = lib.processCampaignSummaryRecord(row,res[row.campaignId]);
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

    function compileResults(j){
        j.request.campaignSummaryAnalytics = Array.prototype.concat(
            Object.keys(j.cacheResults || {}).map(function(id){
                return j.cacheResults[id];
            }),
            Object.keys(j.queryResults || {}).map(function(id){
                return j.queryResults[id];
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

    app.set('trust proxy', 1);
    app.set('json spaces', 2);

    app.use(expressUtils.basicMiddleware());

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
    
    app.use(function(req, res, next) {
        res.header('cache-control', 'max-age=' + state.config.requestMaxAge);
        next();
    });
    
    var sessions = state.sessions;

    
    var authAnalCamp = authUtils.middlewarify({campaigns: 'read'});
    app.get('/api/analytics/campaigns/:id', sessions, authAnalCamp, function(req, res, next) {
        lib.getCampaignSummaryAnalytics(req)
        .then(function(){
            if (req.campaignSummaryAnalytics.length === 0) {
                log.info('[%1] - campaign data not found', req.uuid);
                res.send(404);
            } else {
                log.info('[%1] - returning campaign data', req.uuid);
                res.send(200,req.campaignSummaryAnalytics[0]);
            }
            next();
        })
        .catch(function(err){
            var status = err.status || 500,
                message = (err.status) ? err.message : 'Internal Error';
            if (status < 500) {
                log.info('[%1] - [%2] Error: [%3]',req.uuid,status,(err.message || message));
            }
            else {
                log.error('[%1] - [%2] Error: [%3]',req.uuid,status,(err.message || message));
            }
            res.send(status,message);
            next();
        });
    });
    
    app.get('/api/analytics/campaigns/', sessions, authAnalCamp, function(req, res, next) {
        lib.getCampaignSummaryAnalytics(req)
        .then(function(){
            log.info('[%1] - returning data for %2 campaigns',
                req.uuid, req.campaignSummaryAnalytics.length);
            res.send(200,req.campaignSummaryAnalytics);
            next();
        })
        .catch(function(err){
            var status = err.status || 500,
                message = (err.status) ? err.message : 'Internal Error';
            if (status < 500) {
                log.info('[%1] - [%2] Error: [%3]',req.uuid,status,(err.message || message));
            }
            else {
                log.error('[%1] - [%2] Error: [%3]',req.uuid,status,(err.message || message));
            }
            res.send(status,message);
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
    .then(service.initSessions)
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
