(function(){
    'use strict';
    
    var logger  = require('./logger'),
        enums   = require('./enums'),
        Scope   = enums.Scope;

    /**
     * forbidden is an array of fields that can never appear in the update object. condForbidden is
     * an object mapping field names to functions that should return true or false based on whether
     * the requester should be allowed to update the field. The arguments passed to these functions
     * will be (updates, orig, requester). Required is an array of fields that must appear in the
     * update object.
     */
    var FieldValidator = function(opts) {
        var self = this;
        if (!opts || (!opts.forbidden && !opts.condForbidden && !opts.required)) {
            throw new Error('Cannot create a FieldValidator with no fields to validate');
        }
        self._forbidden = opts.forbidden || [];
        self._condForbidden = opts.condForbidden || {};
        self._required = opts.required || [];
    };
    
    /**
     * First checks and returns false if updates contains any forbidden fields, or if it lacks any
     * required fields. Next, checks for conditionally forbidden fields, and calls the corresponding
     * function for each to determine if that field should be forbidden. If there are multiple
     * functions for the conditionally forbidden field, it does an AND on the results of those
     * functions. Never considers a field in updates invalid if its value is unchanged
     */
    FieldValidator.prototype.validate = function(updates, orig, requester) {
        var self = this,
            log = logger.getLog();
            
        if (!(updates instanceof Object) || !(orig instanceof Object) ||
            !(requester instanceof Object)) {
            log.warn('Updates, orig, and requester must all be objects');
            return false;
        }
        
        if (!self._required.every(function(key) {
            return updates[key] !== undefined && updates[key] !== null;
        })) {
            log.warn('Updates does not contain all required fields: %1', self._required.join(', '));
            return false;
        }
        
        return Object.keys(updates).every(function(key) {
            if (updates[key] === orig[key]) {
                return true;
            }

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
    
    // For use with the CrudSvc middleware. Calls next if validate returns true, and done otherwise 
    FieldValidator.prototype.midWare = function(req, next, done) {
        var self = this,
            log = logger.getLog();

        if (self.validate(req.body, req.origObj || {}, req.user)) {
            next();
        } else {
            log.trace('updates: %1  |  orig: %2  |  requester: %3', JSON.stringify(req.body),
                      JSON.stringify(req.origObj || {}), JSON.stringify(req.user));
            done({code: 400, body: 'Invalid request body'});
        }
    };
    
    FieldValidator.eqReqFieldFunc = function(field) {
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
    
    FieldValidator.orgFunc = function(objName, verb) {
        var eqFunc = FieldValidator.eqReqFieldFunc('org'),
            scopeFunc = FieldValidator.scopeFunc(objName, verb, Scope.All);
        return function(updates, orig, requester) {
            return eqFunc(updates, orig, requester) || scopeFunc(updates, orig, requester);
        };
    };

    module.exports = FieldValidator;
}());
