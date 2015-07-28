(function(){
    'use strict';
    
    var util        = require('util'),
        logger      = require('./logger'),
        objUtils    = require('./objUtils'),
        enums       = require('./enums'),
        AccessLevel = enums.AccessLevel;

    //TODO: test + comment everything, rethink names?
    
    function Model(objName, schema) {
        var self = this;
        self.objName = objName;
        self.schema = schema;
    }


    Model.prototype.personalizeSchema = function(requester) {
        var self = this,
            userSchema = requester.fieldValidation && requester.fieldValidation[self.objName],
            newSchema = {};
        
        objUtils.extend(newSchema, self.schema); // deep copy self.schema
        
        if (!objUtils.isPOJO(userSchema)) {
            return newSchema;
        }
        
        (function mergeSchemaObj(target, userObj) {
            Object.keys(userObj).forEach(function(key) {
                // don't overwrite fields in self.schema that were _locked
                if (target[key] && target[key]._locked) {
                    return;
                }
                
                // never overwrite _type properties from self.schema
                if (key === '_type' && target[key] !== undefined) {
                    return;
                }
                
                // recursively merge if userObj[key] is an object, otherwise take userObj's value
                if (objUtils.isPOJO(userObj[key]) && !(userObj[key] instanceof Date)) {
                    target[key] = target[key] || {};
                    mergeSchemaObj(target[key], userObj[key]);
                } else {
                    target[key] = userObj[key];
                }
            });
        }(newSchema, userSchema));

        return newSchema;
    };
    
    
    /**
     * Check that the val matches the format. Format can be:
     * - String: will check that typeof val === format
     * - Function: will check that val instanceof format
     * - Object { or: [opt1, opt2] }: will recursively check that val matches one of these options
     * - Array [subformat]: will check that val is an array, and each item matches subformat
     */
    Model.checkFormat = function(format, val) {
        var log = logger.getLog();

        if (!format) {
            return true;
        }
        
        if (format instanceof Array) {
            return val instanceof Array && val.every(function(item) {
                return Model.checkFormat(format[0], item);
            });
        }
        
        if (format.or && format.or instanceof Array) {
            return format.or.some(function(option) {
                return Model.checkFormat(option, val);
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
    
    
    Model.checkLimits = function(cfg, value, keyStr) {
        if (!cfg) {
            return { isValid: true };
        }
        
        if ('_min' in cfg && value < cfg._min) {
            return {
                isValid: false,
                reason: keyStr + ' must be less than the min: ' + cfg._min
            };
        }

        if ('_max' in cfg && value > cfg._max) {
            return {
                isValid: false,
                reason: keyStr + ' must be greater than the max: ' + cfg._max
            };
        }
        
        if ('_length' in cfg && value.length > cfg._length) {
            return {
                isValid: false,
                reason: keyStr + ' must have less than max entries: ' + cfg._length
            };
        }
        
        return { isValid: true };
    };

    // TODO: should we worry about nested props getting overwritten to empty obj? (eg camp.pricing)
    Model.prototype.validate = function(newObj, origObj, requester) {
        var self = this,
            log = logger.getLog(),
            actingSchema = self.personalizeSchema(requester),
            failMsg;
            
        origObj = origObj || {};
            
        if (!(newObj instanceof Object) || !(requester instanceof Object) ||
                                           !(origObj instanceof Object)) {
            log.warn('newObj, origObj, and requester must all be objects');
            return false;
        }
        
        function validateField(key, schema, updates, orig, keyStr) {
            // fail if field is required and not present in updates or orig
            if (schema[key]._required && !orig[key] && (updates[key] === undefined ||
                                                        updates[key] === null)) {
                log.info('Updates does not contain required key "%1"', keyStr);
                failMsg = 'Missing required field: ' + keyStr;
                return false;
            }
        
            // pass if field not present
            if (updates[key] === undefined) {
                // set default val if defined in schema //TODO: consider doing defaulting elsewhere?
                if (schema[key]._default !== undefined && (!orig || !orig[key])) {
                    updates[key] = schema[key]._default;
                }
                return true;
            }

            // trim field if forbidden
            if (schema[key]._accessLevel === AccessLevel.Forbidden) {
                log.trace('Updates contains forbidden key "%1", trimming it off', keyStr);
                delete updates[key];
                return true;
            }
            
            // try to cast date strings to Date objects, if _type specifies Date
            if (schema[key]._type === Date && typeof updates[key] === 'string') {
                var casted = new Date(updates[key]);
                if (casted.toString() !== 'Invalid Date') {
                    updates[key] = casted;
                }
            }
            
            // fail if field is wrong type
            if (!Model.checkFormat(schema[key]._type, updates[key])) {
                log.info('Updates contains key "%1" in wrong format', keyStr);
                failMsg = keyStr + ' must be in format: '+ util.inspect(schema[key]._type);
                return false;
            }
            
            // fail if field falls outside limits of acceptable values
            //TODO: recheck limits for orig, in case user's limits have been updated?
            if (schema[key]._accessLevel !== AccessLevel.Allowed) {
                var limitResp = Model.checkLimits(schema[key], updates[key], keyStr);
                
                if (!limitResp.isValid) {
                    failMsg = limitResp.reason;
                    log.info('Failed limit check: %1', failMsg);
                    return false;
                }
            }
            
            return Object.keys(schema[key]).every(function(subKey) {
                // if subKey is _entries, validate every entry in updates[key]
                if (subKey === '_entries' && updates[key] instanceof Array) {
                    return updates[key].every(function(entry, idx) {
                        return Object.keys(schema[key][subKey]).every(function(entryField) {
                            return validateField(
                                entryField,
                                schema[key][subKey],
                                entry,
                                {},
                                keyStr + '[' + idx + '].' + entryField
                            );
                        });
                    });
                }
                
                // do not recurse for '_' subfields part of DSL
                if (/^_.+/.test(subKey)) {
                    return true;
                }
                
                return validateField(
                    subKey,
                    schema[key],
                    updates[key],
                    orig[key] || {},
                    keyStr + '.' + subKey
                );
            });
        }
        
        var isValid = Object.keys(actingSchema).every(function(key) {
            return validateField(key, actingSchema, newObj, origObj, key);
        });
        
        return { isValid: isValid, reason: failMsg };
    };
        
    module.exports = Model;
}());
