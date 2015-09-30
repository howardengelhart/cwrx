(function(){
    'use strict';
    var q = require('q');
    var clone = require('clone');

    function Keeper(){
        var self = this;
        self._deferreds = {};

        Object.defineProperty(self,'pendingCount', {
            get : function() {
                var result = 0;
                Object.keys(self._deferreds).forEach(function(key){
                    result += self._deferreds[key].promise.isPending() ? 1 : 0;
                });
                return result;
            }
        });

        Object.defineProperty(self,'completedCount', {
            get : function() {
                var result = 0;
                Object.keys(self._deferreds).forEach(function(key){
                    result += self._deferreds[key].promise.isPending() ? 0 : 1;
                });
                return result;
            }
        });

        Object.defineProperty(self,'fulfilledCount', {
            get : function() {
                var result = 0;
                Object.keys(self._deferreds).forEach(function(key){
                    result += self._deferreds[key].promise.isFulfilled() ? 1 : 0;
                });
                return result;
            }
        });

        Object.defineProperty(self,'rejectedCount', {
            get : function() {
                var result = 0;
                Object.keys(self._deferreds).forEach(function(key){
                    result += self._deferreds[key].promise.isRejected() ? 1 : 0;
                });
                return result;
            }
        });
    }

    Keeper.prototype.defer = function(id){
        var self = this, deferred;

        deferred = self._deferreds[id];
        if (deferred){
            if (deferred.promise.isPending()){
                return deferred;
            }
        }

        deferred = q.defer();
        deferred.keeperId           = id;
        deferred.keeperCreateTime   = new Date();
        self._deferreds[id]         = deferred;

        return deferred;
    };

    Keeper.prototype.getDeferred = function(id,includeCompleted){
        var self = this, deferred;

        deferred = self._deferreds[id];
        if (deferred){
            if (!deferred.promise.isPending() && !includeCompleted){
                deferred = undefined;
            }
        }

        return deferred;
    };

    Keeper.prototype.remove = function(id,includeCompleted){
        var self = this, deferred = self.getDeferred(id,includeCompleted);
        delete self._deferreds[id];
        return deferred;
    };

    Keeper.prototype.removeCompleted = function(){
        var self = this;
        Object.keys(self._deferreds).forEach(function(key){
            if (!self._deferreds[key].promise.isPending()){
                delete self._deferreds[key];
            }
        });

        return self;
    };

    Keeper.prototype.resolveAll = function(val){
        var self = this;
        Object.keys(self._deferreds).forEach(function(key){
            if (!self._deferreds[key].promise.isPending()){
                return;
            }
            if (val){
                self._deferreds[key].resolve(val);
            } else {
                self._deferreds[key].resolve(key);
            }
        });

        return self;
    };

    Keeper.prototype.rejectAll = function(val){
        var self = this;
        Object.keys(self._deferreds).forEach(function(key){
            if (!self._deferreds[key].promise.isPending()){
                return;
            }
            if (val){
                self._deferreds[key].reject(val);
            } else {
                self._deferreds[key].reject(key);
            }
        });

        return self;
    };

    var Timer = (function() {
        function expire(timer) {
            var $private = timer.__private__;

            var reason = new Error('Timed out after ' + $private.time + ' ms');
            reason.code = 'ETIMEDOUT';

            $private.expired = true;

            var deferred;
            while ((deferred = $private.deferreds.pop())) {
                deferred.reject(reason);
            }
        }

        /**
         * Provides an abstraction to wrap multiple promises into a single running timer.
         *
         * Example:
         * var timer = new PromiseTimer(10000);
         * var promise1 = timer.watch(doStuff());
         * var promise2 = timer.watch(doOtherStuff());
         * var promise3 = timer.watch(doEvenMoreStuff());
         *
         * If any of the promises returned by doStuff(), doOtherStuff() or doEvenMoreStuff()
         * are still pending when the timer expires, their corresponding promises (returned by
         * timer.watch() will be rejected with a timeout Error.
         */
        function Timer(time) {
            this.__private__ = {
                expired: false,
                time: time,
                deferreds: []
            };

            setTimeout(expire.bind(null, this), time);
        }
        Object.defineProperties(Timer.prototype, {
            expired: {
                set: function() {
                    throw new Error('expired is not settable.');
                },
                get: function() {
                    return this.__private__.expired;
                }
            }
        });

        /**
         * Returns a promise that will be resolved with the value/reason of the provided promise
         * when it is resolved, unless the timer expires, where it will be rejected with a timeout
         * error as the reason.
         */
        Timer.prototype.watch = function watch(promise) {
            var $private = this.__private__;
            var deferred = q.defer();

            function resolve(resolver) {
                return function(data) {
                    $private.deferreds.splice($private.deferreds.indexOf(deferred), 1);
                    resolver(data);
                };
            }

            this.__private__.deferreds.push(deferred);
            promise.then(resolve(deferred.resolve), resolve(deferred.reject));

            if (this.expired) { expire(this); }

            return deferred.promise;
        };

        /**
         * Returns a function that will watch() the promise returned by calling the provided fn().
         */
        Timer.prototype.wrap = function wrap(fn) {
            var timer = this;

            return function() {
                return timer.watch(q.fapply(fn, arguments));
            };
        };

        return Timer;
    }());

    function clonePromise(promise) {
        function process(value) {
            if (value instanceof Error) {
                return value;
            }

            return clone(value);
        }

        return q(promise).then(process, function reject(reason) { throw process(reason); });
    }

    module.exports.Keeper = Keeper;
    module.exports.Timer = Timer;
    module.exports.clone = clonePromise;
}());
