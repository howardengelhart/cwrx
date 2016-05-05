/* jshint camelcase: false */
(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        rp              = require('request-promise'),
        rpErrors        = require('request-promise/errors'),
        logger          = require('./logger'),
        objUtils        = require('./objUtils');

    function BeeswaxClient(opts) {
        var self = this;

        opts = opts || {};
        if (!opts.creds || !opts.creds.email || !opts.creds.password) {
            throw new Error('Must provide creds object with email + password');
        }
        
        self.apiRoot = opts.apiRoot || 'https://stingersbx.api.beeswax.com';
        self.debug = opts.debug || false; //TODO: remove this? or at least comment
        self._creds = opts.creds;
        self._cookieJar = rp.jar();
        
        Object.keys(self.entities).forEach(function(entity) {
            var cfg = self.entities[entity];
            self[entity] = {};
            self[entity].find = self._find.bind(self, cfg.endpoint, cfg.idField);
            self[entity].query = self._query.bind(self, cfg.endpoint);
            self[entity].create = self._create.bind(self, cfg.endpoint);
            self[entity].edit = self._edit.bind(self, cfg.endpoint, cfg.idField);
            self[entity].delete = self._delete.bind(self, cfg.endpoint, cfg.idField);
        });
    }
    
    BeeswaxClient.prototype.authenticate = function() {
        var log = logger.getLog(),
            self = this;
        
        return rp.post({
            url: urlUtils.resolve(self.apiRoot, '/rest/authenticate'),
            rejectUnauthorized: false,
            body: {
                email: self._creds.email,
                password: self._creds.password,
                keep_logged_in: true
            },
            json: true,
            jar: self._cookieJar
        })
        .then(function(body) {
            if (body.success === false) {
                return q.reject(body);
            }
            log.trace('Beeswax: Successfully authenticated as %1', self._creds.email);
        })
        .catch(function(error) {
            log.error('Beeswax: Error authenticating: %1', error.message || util.inspect(error));
            return q.reject('Beeswax API error');
        });
    };
    
    BeeswaxClient.prototype.request = function(opts) {
        var log = logger.getLog(),
            self = this;
        
        objUtils.extend(opts, {
            rejectUnauthorized: false,
            json: true,
            jar: self._cookieJar
        });
        
        if (!!self.debug) {
            log.trace('opts = ' + util.inspect(opts));
        }
        
        return rp(opts)
        .catch(rpErrors.StatusCodeError, function(error) {
            if (error.statusCode !== 401) {
                return q.reject(error);
            }
            log.trace('Beeswax: got 401, attempting to authenticate');
            
            return self.authenticate()
            .then(function() {
                return rp(opts);
            });
        })
        .then(function(body) {
            if (body.success === false) { //TODO: add to error? reconsider?
                return q.reject(body);
            }
            return body;
        })
        .catch(function(error) {
            var routeStr = (opts.method || 'get').toUpperCase() + ' ' + opts.url;
            log.error('Beeswax: Error calling %1: %2',
                      routeStr, error.message || util.inspect(error));
            return q.reject('Beeswax API error');
        });
    };
    

    BeeswaxClient.prototype.entities = { //TODO: still not sure about this weird shit...
        advertisers: {
            endpoint: '/rest/advertiser',
            idField: 'advertiser_id'
        },
        campaigns: {
            endpoint: '/rest/campaign',
            idField: 'campaign_id'
        },
        lineItems: {
            endpoint: '/rest/line_item',
            idField: 'line_item_id'
        },
        creatives: {
            endpoint: '/rest/creative',
            idField: 'creative_id'
        }
    };

    BeeswaxClient.prototype._find = function(endpoint, idField, id) {
        var opts = {
            method: 'get',
            url: urlUtils.resolve(this.apiRoot, endpoint),
            body: {}
        };
        opts.body[idField] = id;
        //TODO: if passed no id, this will find the first thing; unsure if we want that
        return this.request(opts).then(function(body) {
            return body.payload[0];
        });
    };

    BeeswaxClient.prototype._query = function(endpoint, body) {
        var opts = {
            method: 'get',
            url: urlUtils.resolve(this.apiRoot, endpoint),
            body: body
        };
        return this.request(opts).then(function(body) {
            return body.payload;
        });
    };

    BeeswaxClient.prototype._create = function(endpoint, body) {
        var opts = {
            method: 'post',
            url: urlUtils.resolve(this.apiRoot, endpoint),
            body: body
        };
        return this.request(opts).then(function(body) {
            //TODO: may want to consider doing a _find and returning its response?
            return body.payload;
        });
    };

    BeeswaxClient.prototype._edit = function(endpoint, idField, id, body) {
        var opts = {
            method: 'put',
            url: urlUtils.resolve(this.apiRoot, endpoint),
            body: {}
        };
        opts.body[idField] = id;
        objUtils.extend(opts.body, body);
        return this.request(opts).then(function(body) {
            //TODO: may want to consider doing a _find and returning its response?
            return body.payload[0];
        });
    };

    BeeswaxClient.prototype._delete = function(endpoint, idField, id) {
        var opts = {
            method: 'delete',
            url: urlUtils.resolve(this.apiRoot, endpoint),
            body: {}
        };
        opts.body[idField] = id;
        // TODO: consider intercepting 406 if error msg has "Could not load ... to delete"
        return this.request(opts).then(function(body) {
            return body.payload[0];
        });
    };
    

    module.exports = BeeswaxClient;
}());
/* jshint camelcase: true */
