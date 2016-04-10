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

    streamUtils.produceEvent = function(eventName, data) {
        if(streamUtils.producer === null) {
            return q.reject('Producer has not been created');
        } else {
            var defaultData = {
                date: new Date()
            };
            var eventData = objUtils.extend(data || { }, defaultData);
            return streamUtils.producer.produce({
                type: eventName,
                data: eventData
            });
        }
    };
    
    module.exports = streamUtils;
}());
