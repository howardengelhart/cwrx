(function(){
    'use strict';

    var rcKinesis = require('rc-kinesis'),
        objUtils = require('./objUtils'),
        q = require('q');
    
    var streamUtils = {};

    streamUtils.producer = null;

    streamUtils.createProducer = function(kinesisConfig) {
        streamUtils.producer = new rcKinesis.JsonProducer(kinesisConfig.streamName, {
            region: kinesisConfig.region
        });
    };

    streamUtils.produceEvent = function(eventName, respType, req, resp, data) {
        if(streamUtils.producer === null) {
            return q.reject('Producer has not been created');
        } else if(resp.code < 200 || resp.code >= 300 || typeof resp.body !== 'object') {
            return q.resolve(false);
        } else {
            var defaultData = {
                date: new Date()
            };
            ['application', 'campaign'].forEach(function(key) {
                if(req[key] && typeof req[key] === 'object') {
                    defaultData[key] = req[key];
                }
            });
            defaultData[respType] = resp.body;
            var eventData = objUtils.extend(data || { }, defaultData);
            return streamUtils.producer.produce({
                type: eventName,
                data: eventData
            });
        }
    };
    
    module.exports = streamUtils;
}());
