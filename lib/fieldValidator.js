(function(){
    'use strict';
    
    var logger  = require('./logger');

    /**
     * forbidden is an array of fields that can never appear in the update object. condForbidden is
     * an object mapping field names to functions that should return true or false based on whether
     * the requester should be allowed to update the field. The arguments passed to these functions
     * will be (updates, orig, requester).
     */
    var FieldValidator = function(opts) {
        var self = this;
        if (!opts || (!opts.forbidden && !opts.condForbidden)) {
            throw new Error('Cannot create a FieldValidator with no fields to validate');
        }
        self._forbidden = opts.forbidden || [];
        self._condForbidden = opts.condForbidden || {};
    };
    
    /**
     * First checks and returns false if updates contains any forbidden fields. Next, checks for
     * conditionally forbidden fields, and calls the corresponding function for each to determine
     * if that field should be forbidden.
     */
    FieldValidator.prototype.validate = function(updates, orig, requester) {
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
    
    FieldValidator.eqFieldFunc = function(field) {
        return function(updates, orig, requester) {
            return updates[field] === requester[field];
        };
    };
    
    FieldValidator.scopeFunc = function(key, verb, scope) {
        return function(updates, orig, requester) {
            return !!(requester.permissions && requester.permissions[key]) &&
                   (requester.permissions[key][verb] === scope);
        };
    };

    module.exports = FieldValidator;
}());
