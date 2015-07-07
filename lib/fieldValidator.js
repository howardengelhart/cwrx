(function(){
    'use strict';
    
    var logger      = require('./logger'),
        objUtils    = require('./objUtils'),
        enums       = require('./enums'),
        Scope       = enums.Scope;

    /**
     * A FieldValidator can validate a request body based on several sets of rules, which should be
     * defined in the opts passed to the constructor:
     * - forbidden is an array of fields that can never appear in the update object
     * - condForbidden is an object mapping field names to functions that should return true or
     *     false based on whether the requester should be allowed to update the field; the arguments
     *     passed to these functions will be (updates, orig, requester)
     * - required is an array of fields that must appear in the update object
     * - formats is an object mapping field names to formats for the field, and is explained below
     * Each of these sets of rules can be modified after the FieldValidator is created.
     */
    var FieldValidator = function(opts) {
        var self = this;
        opts = opts || {};
        self._forbidden = opts.forbidden || [];
        self._condForbidden = opts.condForbidden || {};
        self._required = opts.required || [];
        self._formats = opts.formats || {};
    };
    
    /**
     * Check that the val matches the format. Format can be:
     * - String: will check that typeof val === format
     * - Function: will check that val instanceof format
     * - Object { or: [opt1, opt2] }: will recursively check that val matches one of these options
     * - Array [subformat]: will check that val is an array, and each item matches subformat
     */
    FieldValidator.checkFormat = function(format, val) {
        var log = logger.getLog();

        if (!format) {
            return true;
        }
        
        if (format instanceof Array) {
            return val instanceof Array && val.every(function(item) {
                return FieldValidator.checkFormat(format[0], item);
            });
        }
        
        if (format.or && format.or instanceof Array) {
            return format.or.some(function(option) {
                return FieldValidator.checkFormat(option, val);
            });
        } else if (typeof format === 'string') { // handle format === 'string', 'object', etc.
            return typeof val === format;
        } else if (typeof format === 'function') { // handle format === Object, MyClass, etc.
            return val instanceof format;
        } else {
            log.warn('Invalid format %1', JSON.stringify(format));
            return true;
        }
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
            if (objUtils.compareObjects(updates[key], orig[key])) {
                return true;
            }

            if (self._forbidden.indexOf(key) >= 0) {
                log.warn('Forbidden key %1', key);
                return false;
            } else if (self._condForbidden[key]) {
                if (self._condForbidden[key] instanceof Array) {
                    for (var i in self._condForbidden[key]) {
                        if (!self._condForbidden[key][i](updates, orig, requester)) {
                            log.warn('Conditionally forbidden key %1', key);
                            return false;
                        }
                    }
                } else if (!self._condForbidden[key](updates, orig, requester)) {
                    log.warn('Conditionally forbidden key %1', key);
                    return false;
                }
            }

            if (!FieldValidator.checkFormat(self._formats[key], updates[key])) {
                log.warn('"%1" property is in the wrong format', key);
                return false;
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
            log.trace('updates: %1', JSON.stringify(req.body));
            log.trace('orig: %1', JSON.stringify(req.origObj || {}));
            log.trace('requester: %1', JSON.stringify(req.user));
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
    
    FieldValidator.userFunc = function(objName, verb) {
        var scopeFunc = FieldValidator.scopeFunc(objName, verb, Scope.All);
        return function(updates, orig, requester) {
            return requester.id === updates.user || scopeFunc(updates, orig, requester);
        };
    };

    module.exports = FieldValidator;
}());
