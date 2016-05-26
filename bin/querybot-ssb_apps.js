/*jshint camelcase: false */
var _ut_            = (global.jasmine) ? true : false,
    inspect         = require('util').inspect,
    logger          = require('../lib/logger'),
    q               = require('q'),
    _               = require('lodash'),
    lib             = {};

lib.initializeResponseRecord = function(campaignId){
    var result = { campaignId : campaignId }, refDate, dt, i;
    
    result.summary = { clicks: 0, installs: 0, launches: 0, users: 0, views: 0 };
    result.daily_7  = [];
    result.daily_30 = [];
    result.today    = [];

    for (i = 30; i >= 1; i--) {
        refDate = (new Date(Date.now() + (86400000 * -i))).toISOString().substr(0,10);
        result.daily_30.push(
            { date: refDate, clicks: 0, installs: 0, launches: 0, users: 0, views: 0 }
        );
    }
    
    for (i = 7; i >= 1; i--) {
        refDate = (new Date(Date.now() + (86400000 * -i))).toISOString().substr(0,10);
        result.daily_7.push(
            { date: refDate, clicks: 0, installs: 0, launches: 0, users: 0, views: 0 }
        );
    }
    
    refDate = (new Date()).toISOString().substr(0,10);
    for (i = 0; i <= 23; i++) {
        if (i < 10) {
            dt = refDate + 'T0' + i + ':00:00.000Z';
        } else {
            dt = refDate + 'T' + i + ':00:00.000Z';
        }

        result.today.push({
            hour: dt,
            clicks: 0,
            installs: 0,
            launches: 0,
            users: 0,
            views: 0
        });
    }

    return result;
};

lib.getUncachedCampaignIds = function(response){
    var list = [];
    _.values(response).map(function(data){
        if (!data.cacheTime) {
            list.push(data.campaignId);
        }
    });
    return list;
};

lib.queryParamsFromRequest = function(req){
    var ServiceError = lib.ServiceError, result = { campaignIds : [] };

    return lib.lookupCampaigns(req)
    .then(function(resp){
        result.campaignIds = resp.map(function(item){
            return  item.id;
        });
        
        if( result.campaignIds.length === 0) {
            return q.reject(new ServiceError('Not Found', 404));
        }

        return result;
    });

};

lib.flattenOverallRecord = function(record, obj) {
    var eventCount = parseInt(record.eventCount,10) ;
    if (isNaN(eventCount)){ eventCount = 0; }

    if (obj[record.eventType] !== undefined) {
        obj[record.eventType] = eventCount;
    }

    return obj;
};

lib.queryOverall = function(response){
    var log = logger.getLog(), statement,
        campaignIds = lib.getUncachedCampaignIds(response);

    statement = [
        'SELECT ',
        '    campaign_id as "campaignId",',
        '    CASE event_type',
        '        WHEN \'completedView\' THEN \'views\' ',
        '        WHEN \'link.Action\'   THEN \'clicks\' ',
        '        WHEN \'appInstall\'    THEN \'installs\'',
        '        WHEN \'appLaunch\'     THEN \'launches\'',
        '    END as "eventType",',
        '    SUM(events) as "eventCount"',
        'FROM rpt.campaign_summary_hourly',
        'WHERE event_type IN (\'completedView\',\'link.Action\',\'appInstall\',\'appLaunch\')',
        '      AND campaign_id = ANY($1::text[])',
        'GROUP BY 1,2',
        'UNION',
        'SELECT',
        '    campaign_id as "campaignId",',
        '    \'users\'::text as "eventType",',
        '    SUM(unique_user_views) as "eventCount"',
        'FROM rpt.unique_user_views',
        'WHERE campaign_id = ANY($1::text[])',
        'GROUP BY 1,2',
        'ORDER BY 1,2'
    ];

    log.trace(statement.join('\n'));
    return lib.pgUtils.query(statement.join('\n'), [campaignIds])
        .then(function(result){
            result.rows.forEach(function(row){
                lib.flattenOverallRecord( row,response[row.campaignId].summary);
            });

            return response;
        });
};

lib.flattenDailyRecord = function(record,obj){
    var eventCount = parseInt(record.eventCount,10), r ;
    if (isNaN(eventCount)){ eventCount = 0; }
    
    r = _.find(obj,function(elt){
        return (elt.date === record.recDate);
    });
        

    if (r) {
        if (r[record.eventType] !== undefined) {
            r[record.eventType] = eventCount;
        }
    }

    return obj;
};

lib.queryDaily = function(response ) {
    var log = logger.getLog(), statement,
        campaignIds = lib.getUncachedCampaignIds(response);

    statement = [
        'SELECT  ',
        '    TO_CHAR(rec_ts,\'YYYY-MM-DD\') as "recDate",',
        '    campaign_id as "campaignId",',
        '    CASE event_type',
        '        WHEN \'completedView\' THEN \'views\' ',
        '        WHEN \'link.Action\' THEN \'clicks\' ',
        '        WHEN \'appInstall\' THEN \'installs\'',
        '        WHEN \'appLaunch\' THEN \'launches\'',
        '    END as "eventType",',
        '    SUM(events) as "eventCount"',
        'FROM rpt.campaign_summary_hourly',
        'WHERE   event_type IN (\'completedView\',\'link.Action\',\'appInstall\',\'appLaunch\')',
        '    AND campaign_id = ANY($1::text[])',
        '    AND rec_ts >= date_trunc(\'day\',current_timestamp - interval \'30 days\')',
        '    AND rec_ts < date_trunc(\'day\',current_timestamp )',
        'GROUP BY 1,2,3',
        'UNION',
        'SELECT  ',
        '    TO_CHAR(rec_date,\'YYYY-MM-DD\') as "recDate",',
        '    campaign_id as "campaignId",',
        '    \'users\'::text as "eventType",',
        '    SUM(unique_user_views) as "eventCount"',
        'FROM rpt.unique_user_views_daily',
        'WHERE',
        '    campaign_id = ANY($1::text[])',
        '    AND rec_date >= date_trunc(\'day\',current_timestamp - interval \'30 days\')',
        '    AND rec_date < date_trunc(\'day\',current_timestamp )',
        'GROUP BY 1,2,3',
        'ORDER BY 1,2,3'
    ];
    
    log.trace(statement.join('\n'));
    return lib.pgUtils.query(statement.join('\n'), [campaignIds])
        .then(function(result){
            result.rows.forEach(function(row){

                lib.flattenDailyRecord( row,response[row.campaignId].daily_7);
                lib.flattenDailyRecord( row,response[row.campaignId].daily_30);
            });

            return response;
        });
};

lib.flattenHourlyRecord = function(record,obj){
    var eventCount = parseInt(record.eventCount,10), r ;

    if (isNaN(eventCount)){ eventCount = 0; }

    r = _.find(obj,function(elt){
        return (elt.hour === record.rects.toISOString());
    });
        

    if (r) {
        if (r[record.eventType] !== undefined) {
            r[record.eventType] = eventCount;
        }
    }

    return obj;
};


lib.queryHourly = function(response) {
    var log = logger.getLog(), statement,
        campaignIds = lib.getUncachedCampaignIds(response);

    statement = [
        'SELECT  ',
        '    campaign_id as "campaignId",',
        '    rec_ts as "rects",',
        '    CASE event_type',
        '        WHEN \'unique_user_view\' THEN \'users\' ',
        '        WHEN \'completedView\' THEN \'views\' ',
        '        WHEN \'link.Action\' THEN \'clicks\' ',
        '        WHEN \'appInstall\' THEN \'installs\'',
        '        WHEN \'appLaunch\' THEN \'launches\'',
        '    END as "eventType",',
        '    SUM(events) as "eventCount"',
        'FROM rpt.campaign_summary_hourly',
        'WHERE   ',
        '    campaign_id = ANY($1::text[])',
        '    AND event_type IN (',
        '       \'unique_user_view\',\'completedView\',',
        '       \'link.Action\',\'appInstall\',\'appLaunch\'',
        '    )',
        '    AND rec_ts::date = date_trunc(\'day\',current_timestamp )',
        'GROUP BY 1,2,3',
        'ORDER BY 1,2,3'
    ];
    
    log.trace(statement.join('\n'));
    return lib.pgUtils.query(statement.join('\n'), [campaignIds])
        .then(function(result){
            result.rows.forEach(function(row){
                lib.flattenHourlyRecord( row, response[row.campaignId].today);
            });

            return response;
        });
};

lib.getCampaignDataFromCache = function(campaignId){
    var log = logger.getLog();
    
    return lib.campaignCacheGet(campaignId)
    .catch(function(e){
        log.warn('Cache error: Key=%1, Error=%2', campaignId, e.message);
        return null;
    });
};

lib.setCampaignDataInCache = function(key,data){
    var log = logger.getLog();
    return lib.campaignCacheSet(key, data)
    .then(function(){
        return data;
    })
    .catch(function(e){
        log.warn('Cache set error: Key=%1, Error=%2',key,e.message);
        return data;
    });
};


lib.getAnalytics = function(req) {
    var log = logger.getLog();

    function prepare(){
        var result = {};
        return lib.queryParamsFromRequest(req)
        .then(function(res){
            return q.all(res.campaignIds.map(function(campaignId){
                return lib.getCampaignDataFromCache(campaignId)
                    .then(function(data){
                        if ((data === null) || (data === undefined)){
                            log.info('[%1] Initializing response: Key=%2',
                                req.uuid, campaignId);
                            result[campaignId] = lib.initializeResponseRecord(campaignId);
                        } else {
                            log.info('[%1] Found in Cache: Key=%2, CacheTime=%3',
                                req.uuid, campaignId, data.cacheTime);
                            result[campaignId] = data;
                        }
                    });
            }));
        })
        .then(function(){
            return result;
        });
    }

    function getFromDb(result){
        if (lib.getUncachedCampaignIds(result).length === 0){
            log.info('[%1] Found all requested campaigns in cache, skip db lookups', req.uuid);
            return q(result);
        }

        function getSummaryData(result) {
            return lib.queryOverall(result);
        }

        function getDailyData(result) {
            return lib.queryDaily(result);
        }

        function getHourlyData(result) {
            return lib.queryHourly(result);
        }

        return getSummaryData(result)
        .then(getDailyData)
        .then(getHourlyData);
    }

    function compileResults(result){
        return q.all(_.values(result).map(function(data){
            if (!data.cacheTime){
                data.cacheTime = new Date();
            }
            return lib.setCampaignDataInCache(data.campaignId,data)
            .then(function(data){
                delete data.cacheTime;
                return data;
            });
        }));
    }
    
    return prepare(req)
    .then(getFromDb)
    .then(compileResults);
};

lib.handler = function(params){
    var log                 = logger.getLog(),
        app                 = params.app,
        state               = params.state,
        sessions            = state.sessions,
        authGetCamp         = params.authUtils.middlewarify({
            allowApps: true,
            permissons: { campaigns: 'read' }
        }),
        cloudwatchMetrics   = require('../lib/expressUtils').cloudwatchMetrics,
        cwSingle;

    lib.state            = state;
    lib.pgUtils          = params.pgUtils;
    lib.ServiceError     = params.lib.ServiceError;
    lib.campaignCacheGet = params.lib.campaignCacheGet;
    lib.campaignCacheSet = params.lib.campaignCacheSet;
    lib.lookupCampaigns  = params.lib.lookupCampaigns;
    
    cwSingle = cloudwatchMetrics(
        state.config.cloudwatch.namespace,
        state.config.cloudwatch.sendInterval,
        {
            MetricName : 'Duration',
            Dimensions : [
                {
                    Name : 'Environment',
                    Value : state.config.cloudwatch.environment
                },
                {
                    Name  : 'Function',
                    Value : '/api/analytics/campaigns/showcase/apps/:id'
                }
            ],
            Unit: 'Milliseconds'
        }
    );
    cwSingle.reporter.removeAllListeners('flush');
    cwSingle.reporter.on('flush', function(data) {
        log.info('Sending cwSingle timing metrics to CloudWatch: %1',
            inspect(data));
    });

    app.get('/api/analytics/campaigns/showcase/apps/:id', sessions, authGetCamp, cwSingle,
        function(req, res, next) {
        lib.getAnalytics(req)
        .then(function(results){
            if (!results) {
                log.info('[%1] - campaign data not found', req.uuid);
                res.send(404);
            } else {
                log.info('[%1] - returning campaign data', req.uuid);
                res.send(200,results.shift());
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
};

if (_ut_) {
    module.exports = lib;
} else {
    module.exports = lib.handler;
}
