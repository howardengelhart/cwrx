#!/usr/bin/env node
var q = require('q'),
    util = require('util'),
    BeeswaxClient = require('beeswax-client');
    
var regex = /(^e2e-advertiser--|^\d+ - placements.e2e)/;
    
var beeswax = new BeeswaxClient({
    creds: {
        email: 'ops@cinema6.com',
        password: '07743763902206f2b511bead2d2bf12292e2af82'
    }
});

function cleanCampaigns(advert) {
    return beeswax.campaigns.query({ advertiser_id: advert.advertiser_id }).then(function(resp) {
        if (!resp.success) {
            return q.reject('Failed querying campaigns - ' + util.inspect(resp));
        }
        return q.all(resp.payload.map(function(camp) {
            return beeswax.campaigns.delete(camp.campaign_id).then(function(resp) {
                if (!resp.success) {
                    return q.reject(util.inspect(resp));
                }
                console.log('Successfully deleted campaign', camp.campaign_id);
            })
            .catch(function(error) {
                return q.reject('Failed deleting campaign' + camp.campaign_id + ' - ' + (error.message || util.inspect(error)));
            });
        }));
    })
    .catch(function(error) {
        console.log('Failed cleaning campaigns for', advert.advertiser_id, ' - ', (error.message || util.inspect(error)));
        return q.reject('could not clean campaigns');
    });
}

function cleanCreatives(advert) {
    return beeswax.creatives.query({ advertiser_id: advert.advertiser_id }).then(function(resp) {
        if (!resp.success) {
            return q.reject('Failed querying creatives - ' + util.inspect(resp));
        }
        return q.all(resp.payload.map(function(creative) {
            return beeswax.creatives.edit(creative.creative_id, { active: false }).then(function(resp) {
                return beeswax.creatives.delete(creative.creative_id);
            })
            .then(function(resp) {
                if (!resp.success) {
                    return q.reject(util.inspect(resp));
                }
                console.log('Successfully deleted creative', creative.creative_id);
            })
            .catch(function(error) {
                return q.reject('Failed deleting creative' + creative.creative_id + ' - ' + (error.message || util.inspect(error)));
            });
        }));
    })
    .catch(function(error) {
        console.log('Failed cleaning creatives for', advert.advertiser_id, ' - ', (error.message || util.inspect(error)));
        return q.reject('could not clean creatives');
    });
}

beeswax.advertisers.query({}).then(function(resp) {
    if (!resp.success) {
        return q.reject('Failed querying for advertisers - ' + util.inspect(resp));
    }
    
    var toDelete = (resp.payload || []).filter(function(advert) {
        return regex.test(advert.advertiser_name);
    });
    
    console.log('Going to delete', toDelete.length, 'advertisers matching', regex);
    // console.log(toDelete.map(function(advert) { return advert.advertiser_name; }));
    
    return q.all(toDelete.map(function(advert) {
        return cleanCampaigns(advert).then(function() {
            return cleanCreatives(advert);
        })
        .then(function() {
            return beeswax.advertisers.delete(advert.advertiser_id)
        }).then(function(resp) {
            if (!resp.success) {
                return q.reject('Failed deleting advertiser - ' + util.inspect(resp));
            }
            console.log('Successfully deleted advertiser', advert.advertiser_id);
            console.log('----------------------------------------------------------------------');
        })
        .catch(function(error) {
            console.log('Failed deleting advertiser', advert.advertiser_id, ' - ', (error.message || util.inspect(error)));
            console.log('----------------------------------------------------------------------');
        });
    }));
})
.then(function(results) {
    console.log('All done');
})
.catch(function(error) {
    console.error('Got an error: ');
    console.error(error);
    process.exit(1);
});
