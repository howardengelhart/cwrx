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
        
    /* Node doesn't have Beeswax's root CAs' SSL certs, this module injects common root CAs' certs
     * into https.globalAgent.options + fixes the issue */
    require('ssl-root-cas').inject();
        

    /**
     * Library that simplifies working with Beeswax's API. Instantiate a new client with an opts
     * object like { apiRoot: 'https...', creds: { email: '...', password: '...' } }
     * Library will take care of authenticating when needed behind the scenes.
     */
    function BeeswaxClient(opts) {
        var self = this;

        opts = opts || {};
        if (!opts.creds || !opts.creds.email || !opts.creds.password) {
            throw new Error('Must provide creds object with email + password');
        }
        
        self.apiRoot = opts.apiRoot || 'https://stingersbx.api.beeswax.com';
        self.debug = opts.debug || false; // if set, log.trace() request options
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
    
    // Send a request to authenticate to Beeswax
    BeeswaxClient.prototype.authenticate = function() {
        var log = logger.getLog(),
            self = this;
            
        // Ensure we don't make multiple simulataneous auth requests
        if (self._authPromise) {
            return self._authPromise;
        }
        
        self._authPromise = rp.post({
            url: urlUtils.resolve(self.apiRoot, '/rest/authenticate'),
            body: {
                email: self._creds.email,
                password: self._creds.password,
                keep_logged_in: true // tells Beeswax to use longer lasting sessions
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
    
    // Send a request to Beeswax, handling 401 Unauthenticated errors
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
            });
        }())
        .then(function(body) {
            if (body.success === false) {
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
    
    /**
     * Upon instantiation, the client will setup objects with bound methods for CRUD ops on each
     * supported entity. Each supported entity will have `find`, `query`, `create`, `edit`, and
     * `delete` methods whose functionality is based on the base methods below. So the API will look
     * like:
     *   beeswax.advertisers.find = function() {}
     *   beeswax.advertisers.query = function() {}
     *   ...
     *   beeswax.campaigns.find = function() {}
     *   ...
     *   beeswax.creative.find = function() {}
     *   ...
     * 
     * For now at least, the work of validating request bodies is left to our client code (i.e. if
     * a request body is invalid, this library will reject with the response from Beeswax).
     */
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

    // Send a GET request to find a single entity by id
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

    // Send a GET request to fetch entities by JSON query
    BeeswaxClient.prototype._query = function(endpoint, body) {
        var opts = {
            url: urlUtils.resolve(this.apiRoot, endpoint),
            body: body || {}
        };
        return this.request('get', opts).then(function(body) {
            return { success: true, payload: body.payload };
        });
    };

    // Send a POST request to create a new entity
    BeeswaxClient.prototype._create = function(endpoint, idField, body) {
        var self = this;
        // Beeswax sends a weird 401 error if a body is empty, so handle this here
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

    // Send a PUT request to edit an existing entity by id
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
        return this.request('put', opts).then(function(/*body*/) {
            return self._find(endpoint, idField, id);
        })
        .catch(function(resp) {
            /* Normally an "object not found" error from Beeswax will be cause to warn + return a
             * 4xx, but failOnNotFound can be set to true if client code wants this method to reject
             * in this case. */
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

    // Send a DELETE request to delete an entity by id
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
            /* Normally an "object not found" error from Beeswax will be cause to warn + return a
             * 4xx, but failOnNotFound can be set to true if client code wants this method to reject
             * in this case. */
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
