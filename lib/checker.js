(function(){
    'use strict';
    
    var logger = require('./logger');

    /**
     * forbidden is an array of fields that can never appear in the update object. condForbidden is
     * an object mapping field names to functions that should return true or false based on whether
     * the requester should be allowed to update the field. The arguments passed to these functions
     * will be (updates, orig, requester).
     */
    var Checker = function(forbidden, condForbidden) {
        var self = this;
        if (!forbidden && !condForbidden) {
            throw new Error('Cannot create a checker with no fields to check for');
        }
        self._forbidden = forbidden || [];
        self._condForbidden = condForbidden || {};
        Checker.validateForbidden(self._forbidden);
        Checker.validateCondForbidden(self._condForbidden);
    };

    Checker.validateForbidden = function(forbidden) {
        if (!(forbidden instanceof Array)) {
            throw new Error('forbidden must be an array');
        }
        forbidden.forEach(function(val) {
            if (typeof val !== 'string') {
                throw new Error('forbidden must be an array of strings');
            }
        });
    };

    Checker.validateCondForbidden = function(condForbidden) {
        if (typeof condForbidden !== 'object') {
            throw new Error('condForbidden must be an object');
        }
        Object.keys(condForbidden).forEach(function(key) {
            if (typeof condForbidden[key] !== 'function') {
                throw new Error('values of condForbidden must all be functions');
            }
        });
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
            } else if (Object.keys(self._condForbidden).indexOf(key) >= 0) {
                if (!self._condForbidden[key](updates, orig, requester)) {
                    log.warn('Conditionally forbidden key %1', key);
                    return false;
                }
            }
            return true;
        });
    };

    module.exports = Checker;
}());
