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
        
    //TODO: comment everything
        
    /* Node doesn't have Beeswax's root CAs' SSL certs, this module injects common root CAs' certs
     * into https.globalAgent.options + fixes the issue */
    require('ssl-root-cas').inject();
        
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
            self[entity].create = self._create.bind(self, cfg.endpoint, cfg.idField);
            self[entity].edit = self._edit.bind(self, cfg.endpoint, cfg.idField);
            self[entity].delete = self._delete.bind(self, cfg.endpoint, cfg.idField);
        });
    }
    
    BeeswaxClient.prototype.authenticate = function() {
        var log = logger.getLog(),
            self = this;
            
        if (self._authPromise) {
            return self._authPromise;
        }
        
        self._authPromise = rp.post({
            url: urlUtils.resolve(self.apiRoot, '/rest/authenticate'),
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
                return q.reject(new Error(util.inspect(body)));
            }
            log.trace('Beeswax: Successfully authenticated as %1', self._creds.email);
        })
        .catch(function(error) {
            log.error('Beeswax: Error authenticating: %1', error.message || util.inspect(error));
            return q.reject(error);
        }).finally(function() {
            delete self._authPromise;
        });
        
        return self._authPromise;
    };
    
    BeeswaxClient.prototype.request = function(method, opts) {
        var log = logger.getLog(),
            self = this;
        
        objUtils.extend(opts, {
            json: true,
            jar: self._cookieJar
        });
        
        if (!!self.debug) {
            log.trace('Beeswax: request opts = ' + util.inspect(opts));
        }

        return (function sendRequest() {
            return rp[method](opts)
            .catch(rpErrors.StatusCodeError, function(error) {
                if (error.statusCode !== 401) {
                    return q.reject(error);
                }
                log.trace('Beeswax: got 401, attempting to authenticate');
                
                return self.authenticate().then(sendRequest);
                /*TODO: explain weird case we got? basically when two near-simultaneous requests
                both happen while unauthenticated, the authenticate request doesn't properly auth,
                so both requests fail again with a 401 "User cannot be authenticated" error,
                necessitating another authenticate request */
            });
        }())
        .then(function(body) {
            if (body.success === false) { //TODO: add to error? reconsider?
                return q.reject(new Error(util.inspect(body)));
            }
            return body;
        })
        .catch(function(error) {
            if (error.response) { // Trim response obj off error for cleanliness
                delete error.response;
            }
            return q.reject(error);
        });
    };
    

    BeeswaxClient.prototype.entities = {
        advertisers: {
            endpoint: '/rest/advertiser',
            idField: 'advertiser_id'
        },
        campaigns: {
            endpoint: '/rest/campaign',
            idField: 'campaign_id'
        },
        creatives: {
            endpoint: '/rest/creative',
            idField: 'creative_id'
        }
    };

    BeeswaxClient.prototype._find = function(endpoint, idField, id) {
        var opts = {
            url: urlUtils.resolve(this.apiRoot, endpoint),
            body: {}
        };
        opts.body[idField] = id;
        return this.request('get', opts).then(function(body) {
            return { success: true, payload: body.payload[0] };
        });
    };

    BeeswaxClient.prototype._query = function(endpoint, body) {
        var opts = {
            url: urlUtils.resolve(this.apiRoot, endpoint),
            body: body || {}
        };
        return this.request('get', opts).then(function(body) {
            return { success: true, payload: body.payload };
        });
    };

    BeeswaxClient.prototype._create = function(endpoint, idField, body) {
        var self = this;
        /*TODO: reconsider whether we should be resolving with non-successful responses from here?
         * maybe have some boolean switch that dictates whether these should be rejected/resolved?*/
        if (!objUtils.isPOJO(body) || Object.keys(body || {}).length === 0) {
            return q({
                success: false,
                code: 400,
                message: 'Body must be non-empty object',
            });
        }

        var opts = {
            url: urlUtils.resolve(self.apiRoot, endpoint) + '/strict',
            body: body
        };
        return self.request('post', opts).then(function(body) {
            return self._find(endpoint, idField, body.payload.id);
        });
    };

    BeeswaxClient.prototype._edit = function(endpoint, idField, id, body, failOnNotFound) {
        var self = this;
        if (!objUtils.isPOJO(body) || Object.keys(body || {}).length === 0) {
            return q({
                success: false,
                code: 400,
                message: 'Body must be non-empty object',
            });
        }

        var opts = {
            url: urlUtils.resolve(this.apiRoot, endpoint) + '/strict',
            body: body
        };
        opts.body[idField] = id;
        return this.request('put', opts).then(function(body) {
            return self._find(endpoint, idField, id);
        })
        .catch(function(resp) {
            var notFound = false;
            try {
                notFound = resp.error.payload[0].message.some(function(str) {
                    return (/Could not load object.*to update/).test(str);
                });
            } catch(e) {}
            
            if (!!notFound && !failOnNotFound) {
                return q({
                    success: false,
                    code: 400,
                    message: 'Not found',
                });
            }
            
            return q.reject(resp);
        });
    };

    BeeswaxClient.prototype._delete = function(endpoint, idField, id, failOnNotFound) {
        var opts = {
            url: urlUtils.resolve(this.apiRoot, endpoint) + '/strict',
            body: {}
        };
        opts.body[idField] = id;

        return this.request('del', opts).then(function(body) {
            return { success: true, payload: body.payload[0] };
        })
        .catch(function(resp) {
            var notFound = false;
            try {
                notFound = resp.error.payload[0].message.some(function(str) {
                    return (/Could not load object.*to delete/).test(str);
                });
            } catch(e) {}
            
            if (!!notFound && !failOnNotFound) {
                return q({
                    success: false,
                    code: 400,
                    message: 'Not found',
                });
            }
            
            return q.reject(resp);
        });
    };
    

    module.exports = BeeswaxClient;
}());
/* jshint camelcase: true */
