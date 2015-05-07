/*jslint camelcase: false */
(function(){
    'use strict';
    var q           = require('q'),
        util        = require('util'),
        path        = require('path'),
        logger      = require('./logger');

    //TODO: reconsider loglevel on cache errors
    
    function JobManager(cache, opts) {
        var log = logger.getLog(),
            self = this;
        opts = opts || {};
        
        self.cache = cache;

        self.cfg = {
            enabled: !!opts.enabled,
            timeout: opts.timeout || 5*1000,
            cacheTTL: opts.cacheTTL || 60*60*1000,
            urlPrefix: opts.urlPrefix || '/job'
        };

        if (!cache && opts.enabled) {
            log.warn('No cache provided so switching JobManager to disabled');
            self.cfg.enabled = false;
        }
    }

    /**
     * Sets up a timeout that will send an early response if a request takes too long. After a
     * configured delay, this will send the client a 202 status with the req's uuid, and it will
     * write this response to the cache. This should be called at the beginning of every request
     * handler.
     */
    JobManager.prototype.setJobTimeout = function(req, res) {
        var log = logger.getLog(),
            self = this,
            timeoutObj = { timedOut: false };
            
        if (!self.cfg.enabled) {
            return timeoutObj;
        }
            
        timeoutObj.timeout = setTimeout(function() {
            timeoutObj.timedOut = true;
            log.info('[%1] Request took too long, sending and caching 202', req.uuid);
            
            var data = { code: 202, body: { url: path.join(self.cfg.urlPrefix, req.uuid) } };

            self.cache.add('req:' + req.uuid, data, self.cfg.cacheTTL)
            .then(function() {
                log.info('[%1] Successfully wrote 202 to cache', req.uuid);
                res.send(data.code, data.body);
            })
            .catch(function(error) {
                log.warn('[%1] Failed to write 202 to cache: %2',
                          req.uuid, (error && error.stack || error));
            });
        }, self.cfg.timeout);
        
        return timeoutObj;
    };
    
    /**
     * The counterpart to setReqTimeout, which should be called at the end of every request handler
     * in which setReqTimeout was called. It should be called with the express req object, state of
     * the handler's final returned promise (retrieve with promise.inspect()), and timeout object
     * returned by setReqTimeout. It will cancel the request timeout if it hasn't fired yet;
     * otherwse, it will write the final response to the cache.
     */
    JobManager.prototype.checkJobTimeout = function(req, promiseResult, timeoutObj) {
        var log = logger.getLog(),
            self = this,
            body;
            
        if (!self.cfg.enabled) {
            return q();
        }

        if (!timeoutObj.timedOut) {
            clearTimeout(timeoutObj.timeout);
            return q();
        }
        
        if (promiseResult.state === 'fulfilled') {
            body = { code: promiseResult.value.code, body: promiseResult.value.body };
        } else {
            body = {
                code: 500,
                body: { error: 'Internal Error', detail: util.inspect(promiseResult.reason) }
            };
        }

        return self.cache.set('req:' + req.uuid, body, self.cfg.cacheTTL)
        .then(function() {
            log.info('[%1] Successfully wrote final response to cache', req.uuid);
        })
        .catch(function(error) {
            log.warn('[%1] Failed to write final response to cache: %2',
                      req.uuid, (error && error.stack || error));
        });
    };

    // Look up a request id in our cache and see if there is a stored result
    JobManager.prototype.getJobResult = function(req, id) {
        var log = logger.getLog(),
            self = this;
        
        if (!self.cfg.enabled) {
            log.warn('[%1] Job manager not enabled so cannot get result for %2', req.uuid, id);
            return q({code: 404, body: 'No result with that id found'});
        }

        log.info('[%1] Looking up result for %2', req.uuid, id);

        return self.cache.get('req:' + id)
        .then(function(resp) {
            if (!resp) {
                log.info('[%1] No result found for request %2', req.uuid, id);
                return q({code: 404, body: 'No result with that id found'});
            }
            log.info('[%1] Found result with code %2 for %3', req.uuid, resp.code, id);
            return q(resp);
        })
        .catch(function(error) {
            log.warn('[%1] Failed to lookup %2 in cache: %3', req.uuid, id, error);
            return q.reject('Cache error');
        });
    };

    module.exports = JobManager;
}());
