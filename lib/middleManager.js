(function(){
    'use strict';

    var q               = require('q'),
        logger          = require('./logger');
        
    /**
     * The MiddleManager is a basic class for setting up + using stacks of middleware, intended to
     * be used for handling requests.
     * Middleware can be setup for a given "action" by calling the use() method:
     *   svc.use('myAction', doThing1);
     *   svc.use('myAction', doThing2);
     * An action can then be run by calling runAction():
     *   svc.runAction(req, 'myAction', handleMyAction)
     * This would doThing1() and doThing2() before finally calling handleMyAction().
     *
     * Middleware functions are called with:
     * - req: Express request object
     * - next: Function; call with no args to proceed to the next middleware step
     * - done: Function; call with a response object ({code: #, body: '...'}) to break out of an
     *         action early and cease executing middleware. 
     * In the event of an unexpected error, a middleware function should return a rejected promise
     * or throw an error; this will break out of the action and log an error.
     */
        
    function MiddleManager() {
        this._middleware = {};
    }


    // Adds the func to the list of middleware for the appropriate action (initializing if needed)
    MiddleManager.prototype.use = function(action, func) {
        if (typeof func !== 'function') {
            throw new Error('Cannot push item of type ' + (typeof func) + ' onto midware stack');
        }
        if (!this._middleware[action]) {
            this._middleware[action] = [];
        }
        this._middleware[action].push(func);
    };

    /**
     * A recursive method that runs through all the middleware for the given action. done will be
     * called if all the middleware completes successfully; otherwise, this will return a resolved
     * or rejected promise depending on whether the failure was expected (4xx) or unexpected (5xx).
     */
    MiddleManager.prototype._runMiddleware = function(req, action, done, idx, deferred) {
        var self = this,
            next = q.defer();

        deferred = deferred || q.defer();
        idx = idx || 0;

        if (!self._middleware[action] || !self._middleware[action][idx]) {
            done();
            return deferred.promise;
        }

        next.promise.then(function() {
            return self._runMiddleware(req, action, done, ++idx, deferred);
        });

        q.fcall(self._middleware[action][idx], req, next.resolve, deferred.resolve)
        .catch(deferred.reject);

        return deferred.promise;
    };

    /* Runs the middleware stack for actionName, and on success calls the provided cb. The cb should
     * return a promise, and runAction will resolve/reject with that promise's value/reason. */
    MiddleManager.prototype.runAction = function(req, actionName, cb) {
        var self = this,
            deferred = q.defer(),
            log = logger.getLog();

        self._runMiddleware(req, actionName, function() {
            q.fcall(cb)
            .then(deferred.resolve)
            .catch(deferred.reject);
        })
        .then(function(resp) {
            log.info('[%1] Broke out of middleware, not doing %2', req.uuid, actionName);
            deferred.resolve(resp);
        })
        .catch(function(err) {
            log.error('[%1] Failed running middleware for %2: %3',
                      req.uuid, actionName, err && err.stack || err);
            deferred.reject(err);
        });

        return deferred.promise;
    };

    module.exports = MiddleManager;
}());
