(function(){
    'use strict';
    
    var logger  = require('./logger');

    /**
     * forbidden is an array of fields that can never appear in the update object. condForbidden is
     * an object mapping field names to functions that should return true or false based on whether
     * the requester should be allowed to update the field. The arguments passed to these functions
     * will be (updates, orig, requester).
     */
       //TODO: wrap the arguments into an args object
    var Checker = function(forbidden, condForbidden) {
        var self = this;
        if (!forbidden && !condForbidden) {
            throw new Error('Cannot create a checker with no fields to check for');
        }
        self._forbidden = forbidden || [];
        self._condForbidden = condForbidden || {};
    };
    
    /**
     * First checks and returns false if updates contains any forbidden fields. Next, checks for
     * conditionally forbidden fields, and calls the corresponding function for each to determine
     * if that field should be forbidden.
     */
    Checker.prototype.check = function(updates, orig, requester) {
        var self = this,
            log = logger.getLog();
        if (!(updates instanceof Object) || !(orig instanceof Object) ||
            !(requester instanceof Object)) {
            log.warn('Updates, orig, and requester must all be objects');
            return false;
        }
        return Object.keys(updates).every(function(key) {
            if (self._forbidden.indexOf(key) >= 0) {
                log.warn('Forbidden key %1', key);
                return false;
            } else if (self._condForbidden[key]) {
                if (self._condForbidden[key] instanceof Array) {
                    return self._condForbidden[key].every(function(checkFunc) {
                        if (!checkFunc(updates, orig, requester)) {
                            log.warn('Conditionally forbidden key %1', key);
                            return false;
                        }
                        return true;
                    });
                } else if (!self._condForbidden[key](updates, orig, requester)) {
                    log.warn('Conditionally forbidden key %1', key);
                    return false;
                }
            }
            return true;
        });
    };
    
    Checker.eqFieldFunc = function(field) {
        return function(updates, orig, requester) {
            return updates[field] === requester[field];
        };
    };
    
    Checker.scopeFunc = function(key, verb, scope) {
        return function(updates, orig, requester) {
            return !!(requester.permissions && requester.permissions[key]) &&
                   (requester.permissions[key][verb] === scope);
        };
    };

    module.exports = Checker;
}());
