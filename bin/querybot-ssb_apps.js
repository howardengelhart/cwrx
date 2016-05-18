/*jshint camelcase: false */
var _ut_            = (global.jasmine) ? true : false,
    logger          = require('../lib/logger'),
    q               = require('q'),
    _               = require('lodash'),
    lib             = {};

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

    if (!obj) {
        obj = { clicks: 0, installs: 0, launches: 0, users: 0, views: 0 };
    }

    if (obj[record.eventType] !== undefined) {
        obj[record.eventType] = eventCount;
    }

    return obj;
};

lib.queryOverall = function(campaignIds){
    var log = logger.getLog(), statement;

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
            var res ;
            result.rows.forEach(function(row){
                if (res === undefined) {
                    res = {};
                }

                if (!res[row.campaignId]){
                    res[row.campaignId] = {
                        campaignId : row.campaignId
                    };
                }

                res[row.campaignId].summary = lib.flattenOverallRecord(
                    row,res[row.campaignId].summary
                );
            });

            return res;
        });
};

lib.flattenDailyRecord = function(daysBack,record,obj){
    var eventCount = parseInt(record.eventCount,10), refDate, i, r ;
    if (isNaN(eventCount)){ eventCount = 0; }

    if (!obj) {
        obj = [];
        for (i = daysBack; i >= 1; i--) {
            refDate = (new Date(Date.now() + (86400000 * -i))).toISOString().substr(0,10);
            obj.push({ date: refDate, clicks: 0, installs: 0, launches: 0, users: 0, views: 0 });
        }
    }

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

lib.queryDaily = function(campaignIds ) {
    var log = logger.getLog(), statement;

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
            var res ;
            result.rows.forEach(function(row){
                if (res === undefined) {
                    res = {};
                }

                if (!res[row.campaignId]){
                    res[row.campaignId] = { };
                }

                res[row.campaignId].daily_7 = lib.flattenDailyRecord(
                    7,row,res[row.campaignId].daily_7
                );
                
                res[row.campaignId].daily_30 = lib.flattenDailyRecord(
                    30,row,res[row.campaignId].daily_30
                );
            });

            return res;
        });
};

lib.flattenHourlyRecord = function(record,obj){
    var eventCount = parseInt(record.eventCount,10), refDate, dt, i, r ;

    if (isNaN(eventCount)){ eventCount = 0; }

    if (!obj) {
        obj = [];
        refDate = (new Date()).toISOString().substr(0,10);
        for (i = 0; i <= 23; i++) {
            if (i < 10) {
                dt = refDate + 'T0' + i + ':00:00.000Z';
            } else {
                dt = refDate + 'T' + i + ':00:00.000Z';
            }

            obj.push({
                hour: dt,
                clicks: 0,
                installs: 0,
                launches: 0,
                users: 0,
                views: 0
            });
        }
    }

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


lib.queryHourly = function(campaignIds) {
    var log = logger.getLog(), statement;

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
            var res ;
            result.rows.forEach(function(row){
                if (res === undefined) {
                    res = {};
                }

                if (!res[row.campaignId]){
                    res[row.campaignId] = { };
                }

                res[row.campaignId].today = lib.flattenHourlyRecord(
                    row,res[row.campaignId].today
                );
            });

            return res;
        });
};

lib.getAnalytics = function(req) {
    var campaignIds, result;

    function prepare(r){
        return lib.queryParamsFromRequest(r)
            .then(function(res){
                campaignIds = res.campaignIds;
            });
    }

    function getSummaryData() {
        return lib.queryOverall(campaignIds)
            .then(function(res){
                result = res;
                return result;
            });
    }

    function getDailyData() {
        return lib.queryDaily(campaignIds)
            .then(function(res){
                Object.keys(result).forEach(function(campaignId){
                    if (res[campaignId]){
                        result[campaignId].daily_7  = res[campaignId].daily_7;
                        result[campaignId].daily_30 = res[campaignId].daily_30;
                    }
                });
                return result;
            });
    }

    function getHourlyData() {
        return lib.queryHourly(campaignIds)
            .then(function(res){
                Object.keys(result).forEach(function(campaignId){
                    if (res[campaignId]){
                        result[campaignId].today = res[campaignId].today;
                    }
                });
                return result;
            });
    }

    function compileResults(){
        return q(_.values(result));
    }
    
    return prepare(req)
    .then(getSummaryData)
    .then(getDailyData)
    .then(getHourlyData)
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
        });

    lib.state            = state;
    lib.pgUtils          = params.pgUtils;
    lib.ServiceError     = params.lib.ServiceError;
    lib.campaignCacheGet = params.lib.campaignCacheGet;
    lib.campaignCacheSet = params.lib.campaignCacheSet;
    lib.lookupCampaigns  = params.lib.lookupCampaigns;

    app.get('/api/analytics/campaigns/showcase/apps/:id', sessions, authGetCamp,
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
