/*jshint camelcase: false */
var _ut_            = (global.jasmine) ? true : false,
    logger          = require('../lib/logger'),
    inspect         = require('util').inspect,
    url             = require('url'),
    q               = require('q'),
    requestUtils    = require('../lib/requestUtils'),
    lib = {};

lib.getCampaignDataFromCache = function(campaignIds,startDate,endDate,keyScope){
    var log = logger.getLog(), retval;
    return q.all(campaignIds.map(function(id){
        var key = [ id, startDate || 'null', endDate || 'null', keyScope ].join(':');
        return lib.campaignCacheGet(key).catch(function(e){
            log.warn('Cache error: Key=%1, Error=%2', key, e.message);
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

lib.setCampaignDataInCache = function(data,startDate,endDate,keyScope){
    var log = logger.getLog();
    return q.all(Object.keys(data).map(function(id){
        var key = [ id, startDate || 'null', endDate || 'null', keyScope ].join(':');
        log.trace('Store campaign[%1] in cache.',key);
        return lib.campaignCacheSet(key, data[id]);
    }))
    .then(function(){
        return data;
    })
    .catch(function(e){
        log.warn(e.message);
        return data;
    });
};


lib.queryParamsFromRequest = function(req){
    var log = logger.getLog(), ids = {}, idList = '',
        ServiceError = lib.ServiceError,
        urlBase = url.resolve(lib.state.config.api.root , '/api/campaigns/'),
        result = { campaignIds : [], startDate : null, endDate : null };
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

    if (req.query.startDate) {
        if (req.query.startDate.match(/^\d\d\d\d-\d\d-\d\d$/)){
            result.startDate = req.query.startDate;
        } else {
            return q.reject(
                new ServiceError('Invalid startDate format, expecting YYYY-MM-DD.', 400)
            );
        }
    }

    if (req.query.endDate) {
        if (req.query.endDate.match(/^\d\d\d\d-\d\d-\d\d$/)){
            result.endDate = req.query.endDate;
        } else {
            return q.reject(
                new ServiceError('Invalid endDate format, expecting YYYY-MM-DD.', 400)
            );
        }
    }

    idList = ids.join(',');
    log.trace('[%1] campaign check: %2, ids=%3', req.uuid,urlBase , idList);
    return requestUtils.proxyRequest(req, 'get', {
        url: urlBase,
        qs : {
            ids    : idList,
            fields : 'id'
        }
    })
    .then(function(resp){
        log.trace('[%1] STATUS CODE: %2',req.uuid,resp.response.statusCode);
        if (resp.response.statusCode === 200) {
            log.trace('[%1] campaign found: %2',req.uuid,resp.response.body);
            result.campaignIds = resp.body.map(function(item){
                return  item.id;
            });
        } else {
            log.error('[%1] Campaign Check Failed with: %2 : %3',
                req.uuid,resp.response.statusCode,resp.body);
        }
        return result;
    });
};


// Because we maybe returning only the billable views, which may be less than the total views
// we have to account for quartiles that may exceed the number of billable views.  This function
// will scale the quartiles down, based on the ration of quartile events to actual views, being
// applied to the billable views for each quartile. This method also makes sure we don't end up
// showing clicks in the weird scneario that there may 0 billable views.  Which generally shouldn't
// happen.
//
lib.adjustCampaignSummary = function(summary) {
    var section, sectionKey, ratio, actualViews, i, quartile;
    for (sectionKey in summary) {
        section = summary[sectionKey];
        actualViews = section.actualViews;
        delete section.actualViews;

        if (!actualViews)                   { continue; }
        if (section.views >= actualViews)   { continue; }

        for (i = 1; i <= 4; i++) {
            quartile = 'quartile' + i;
            if (section[quartile] > 0) {
                ratio = Math.round((section[quartile] / actualViews) * 100) / 100;
                section[quartile] = Math.round(section.views * ratio);
            }
        }

        if (!section.views) {
            section.linkClicks  = {};
            section.shareClicks = {};
        }
    }

    return summary;
};

lib.processCampaignSummaryRecord = function(record, obj, startDate, endDate) {
    var m, eventCount = parseInt(record.eventCount,10), sub ;
    if (isNaN(eventCount)){
        eventCount = 0;
    }
    if (!obj) {
        obj = {
            campaignId : record.campaignId,
            summary : {
                impressions : 0,
                views       : 0,
                quartile1   : 0,
                quartile2   : 0,
                quartile3   : 0,
                quartile4   : 0,
                totalSpend  : '0.0000',
                linkClicks  : {},
                shareClicks : {}
            },
            today : {
                impressions : 0,
                views       : 0,
                quartile1   : 0,
                quartile2   : 0,
                quartile3   : 0,
                quartile4   : 0,
                totalSpend  : '0.0000',
                linkClicks  : {},
                shareClicks : {}
            }
        };
        if (startDate || endDate) {
            obj.range = {
                startDate   : startDate,
                endDate     : endDate,
                impressions : 0,
                views       : 0,
                quartile1   : 0,
                quartile2   : 0,
                quartile3   : 0,
                quartile4   : 0,
                totalSpend  : '0.0000',
                linkClicks  : {},
                shareClicks : {}
            };
        }
    }

    if (record.range === 'today'){
        sub = obj.today;
    } else
    if (record.range === 'user'){
        sub = obj.range;
    } else {
        sub = obj.summary;
    }
    
    if (record.eventType === 'cardView') {
        sub.impressions = eventCount;
    } else
    if (record.eventType === 'q1') {
        sub.quartile1 = eventCount;
    } else
    if (record.eventType === 'q2') {
        sub.quartile2 = eventCount;
    } else
    if (record.eventType === 'q3') {
        sub.quartile3 = eventCount;
    } else
    if (record.eventType === 'q4') {
        sub.quartile4 = eventCount;
    } else
    if (record.eventType === 'completedView') {
        if (lib.state.config.useActualViews) {
            sub.views       = eventCount;
            sub.totalSpend  = record.eventCost;
        } else {
            sub.actualViews = eventCount;
        }
    } else
    if ((record.eventType === 'billableView') && (!lib.state.config.useActualViews)) {
        sub.views           = eventCount;
        sub.totalSpend      = record.eventCost;
    } else  {
        m = record.eventType.match(/shareLink\.(.*)/);
        if (m) {
            sub.shareClicks[m[1].toLowerCase()] = eventCount;
        } else {
            m = record.eventType.match(/link\.(.*)/);
            if (m) {
                sub.linkClicks[m[1].toLowerCase()] = eventCount;
            }
        }
    }

    return obj;
};


lib.datesToDateClause = function(startDate,endDate,fieldName) {
    var dateClause = null;

    if (startDate){
        dateClause = fieldName + ' >= \'' +  startDate + '\'';
    }

    if (endDate) {
        dateClause = (dateClause !== null) ? (dateClause + ' AND ') : '';
        dateClause += fieldName + ' < (date \'' + endDate + '\' + interval \'1 day\')';
    }

    return dateClause;
};

lib.queryCampaignSummary = function(campaignIds,startDate,endDate) {
    var log = logger.getLog(),
        dateClause  = lib.datesToDateClause(startDate,endDate,'rec_ts'),
        dateClause2 = lib.datesToDateClause(startDate,endDate,'transaction_ts'),
        statement;
        
    
    statement = [
        'select campaign_id as "campaignId" ,\'summary\' as "range",',
        '   event_type as "eventType",',
        'sum(events) as "eventCount", sum(event_cost) as "eventCost"',
        'from rpt.campaign_summary_hourly',
        'where campaign_id = ANY($1::text[])',
        'and NOT event_type = ANY($2::text[])',
        'group by 1,2,3',
        'union',
        'select campaign_id as "campaignId" ,\'summary\' as "range",',
        '   \'billableView\' as "eventType",',
        'sum(units) as "eventCount", sum(amount) as "eventCost"',
        'from fct.billing_transactions',
        'where campaign_id = ANY($1::text[])',
        'and sign = -1',
        'and amount > 0',
        'group by 1,2,3',
        'union',
        'select campaign_id as "campaignId" ,\'today\' as "range",',
        '   event_type as "eventType",',
        'sum(events) as "eventCount", sum(event_cost) as "eventCost"',
        'from rpt.campaign_summary_hourly',
        'where campaign_id = ANY($1::text[])',
        'and NOT event_type = ANY($2::text[])',
        'and rec_ts >= current_timestamp::date',
        'group by 1,2,3',
        'union',
        'select campaign_id as "campaignId" ,\'today\' as "range",',
        '   \'billableView\' as "eventType",',
        'sum(units) as "eventCount", sum(amount) as "eventCost"',
        'from fct.billing_transactions',
        'where campaign_id = ANY($1::text[])',
        'and transaction_ts >= current_timestamp::date',
        'and sign = -1',
        'and amount > 0',
        'group by 1,2,3'
    ];
    
    if (dateClause) {
        statement = statement.concat([
            'union',
            'select campaign_id as "campaignId" ,\'user\' as "range",',
            '   event_type as "eventType",',
            'sum(events) as "eventCount", sum(event_cost) as "eventCost"',
            'from rpt.campaign_summary_hourly',
            'where campaign_id = ANY($1::text[])',
            'and NOT event_type = ANY($2::text[])',
            'AND (' + dateClause + ')',
            'group by 1,2,3',
            'union',
            'select campaign_id as "campaignId" ,\'user\' as "range",',
            '   \'billableView\' as "eventType",',
            'sum(units) as "eventCount", sum(amount) as "eventCost"',
            'from fct.billing_transactions',
            'where campaign_id = ANY($1::text[])',
            'AND (' + dateClause2 + ')',
            'and sign = -1',
            'and amount > 0',
            'group by 1,2,3'
        ]);
    }
    statement.push('order by 1,2');
    log.trace(statement.join('\n'));
    return lib.pgUtils.query(statement.join('\n'),
        [campaignIds,['launch','load','play','impression','requestPlayer']])
        .then(function(result){
            var res, campId ;
            result.rows.forEach(function(row){
                if (res === undefined) {
                    res = {};
                }
                res[row.campaignId] = lib.processCampaignSummaryRecord(
                    row,res[row.campaignId],startDate,endDate
                );

            });

            for (campId in res) {
                lib.adjustCampaignSummary(res[campId]);
            }

            return res;
        });
};

lib.getCampaignSummaryAnalytics = function(req){

    function prepare(r){
        return lib.queryParamsFromRequest(r)
            .then(function(res){
                return {
                    request      : r,
                    keyScope     : 'summary',
                    cacheResults : null,
                    queryResults : null,
                    campaignIds  : res.campaignIds,
                    startDate    : res.startDate,
                    endDate      : res.endDate
                };
            });
    }

    function getDataFromCache(j){
        if (!j.campaignIds || !(j.campaignIds.length)){
            return j;
        }
        return lib.getCampaignDataFromCache(j.campaignIds,j.startDate,j.endDate,j.keyScope)
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
        return lib.queryCampaignSummary(j.campaignIds,j.startDate,j.endDate)
            .then(function(res){
                j.queryResults = res;
                if (!res) {
                    return j;
                }
                return lib.setCampaignDataInCache(res,j.startDate,j.endDate,j.keyScope)
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


lib.handler = function(params){
    var log                 = logger.getLog(),
        app                 = params.app,
        sessions            = params.callbacks.sessions,
        authGetCamp         = params.callbacks.authGetCamp,
        state               = params.state,
        cloudwatchMetrics   = require('../lib/expressUtils').cloudwatchMetrics,
        cwCampaignSummarySingle, cwCampaignSummaryMulti;
    
    lib.pgUtils = params.pgUtils;
    lib.state   = state;
    lib.ServiceError     = params.lib.ServiceError;
    lib.campaignCacheGet = params.lib.campaignCacheGet;
    lib.campaignCacheSet = params.lib.campaignCacheSet;

    cwCampaignSummarySingle = cloudwatchMetrics(
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
                    Value : '/api/analytics/campaigns/:id'
                }
            ],
            Unit: 'Milliseconds'
        }
    );
    cwCampaignSummarySingle.reporter.removeAllListeners('flush');
    cwCampaignSummarySingle.reporter.on('flush', function(data) {
        log.info('Sending cwCampaignSummarySingle timing metrics to CloudWatch: %1',
            inspect(data));
    });

    cwCampaignSummaryMulti = cloudwatchMetrics(
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
                    Value : '/api/analytics/campaigns/'
                }
            ],
            Unit: 'Milliseconds'
        }
    );

    cwCampaignSummaryMulti.reporter.removeAllListeners('flush');
    cwCampaignSummaryMulti.reporter.on('flush', function(data) {
        log.info('Sending cwCampaignSummaryMulti timing metrics to CloudWatch: %1',
            inspect(data));
    });


    app.get('/api/analytics/campaigns/:id', sessions, authGetCamp, cwCampaignSummarySingle,
        function(req, res, next) {
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
    
    app.get('/api/analytics/campaigns/', sessions, authGetCamp, cwCampaignSummaryMulti,
        function(req, res, next) {
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
};

if (_ut_) {
    module.exports = lib;
} else {
    module.exports = lib.handler;
}
