#!/usr/bin/env node
var q = require('q'),
    util = require('util'),
    BeeswaxClient = require('beeswax-client'),
    env             = process.argv[2] || 'test',
    path            = require('path'),
    creds           = require(path.join(process.env.HOME,'.bw.json'))[env];

var campaignIds = process.argv[3].split(',');

var beeswax = new BeeswaxClient({ apiRoot : creds.hostname, creds : creds });

function updateCampaign(campaignId) {
    return beeswax.campaigns.query({ alternative_id: campaignId })
    .then(function(resp) {
        if (!resp.success) {
            return q.reject('Failed querying campaign - ' + util.inspect(resp));
        }
        return resp.payload[0];
    })
    .then(function(campaign){
        var ts = campaign.start_date.split(' ');
        if (ts[1] === '00:00:00'){
            console.log('Campaign ', campaign.alternative_id, ' (', campaign.campaign_id, ')',
                'Already has midnight start date.');
            return campaign;
        }

        ts[1] = '00:00:00';

        return beeswax.campaigns.edit(campaign.campaign_id,{ start_date : ts.join(' ') })
        .then(function(resp){
            if (!resp.success){
                return q.reject('Failed updating campaign - ' + util.inspect(resp));
            }
            console.log('Campaign ', campaign.alternative_id, ' (', campaign.campaign_id, ')',
                'Start date is now: ', resp.payload.start_date);

            return resp.payload;
        });
    })
    .catch(function(error) {
        console.log('Campaign ', campaignId, ' Failed with: ', (error.message || util.inspect(error)));
    });
}

return q.all(campaignIds.map(function(campaignId){
    return updateCampaign(campaignId).catch(function(){});
}));
