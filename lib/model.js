(function(){
    'use strict';
    
    var util        = require('util'),
        logger      = require('./logger'),
        objUtils    = require('./objUtils'),
        enums       = require('./enums'),
        AccessLevel = enums.AccessLevel;

    /**
     * A Model represents the standard format of an entity in our system and can be used to validate
     * new entities or edits to existing ones. It should be instantiated with the pluralized name
     * of the entity type ('campaigns', 'experiences', etc.) and a schema, which is a set of base
     * fieldValidation rules. This schema will be merged with the requester's fieldValidation rules
     * for the entity type when validating a request body.
     */
    function Model(objName, schema) {
        var self = this;
        self.objName = objName;
        self.schema = schema;
    }

    /**
     * Merge the model's schema with the requester's fieldValidation rules for this entity.
     * Works differently than merging fieldValidation in policies: this takes the base schema and
     * then copies over all fields from the requester's fieldValidation, taking the values from the
     * requester when conflicts exist with two exceptions:
     * - All `_type` properties in the schema are preserved.
     * - Any config block in the schema with `_locked = true` will not be changed at all.
     */
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
                // don't overwrite fields in self.schema that are _locked
                if (target[key] && target[key]._locked) {
                    return;
                }
                
                // never overwrite _type properties from self.schema
                if (key === '_type' && target[key] !== undefined) {
                    return;
                }
                
                // recursively merge if userObj[key] is an object, otherwise take userObj's value
                if (objUtils.isPOJO(userObj[key])) {
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
     * Check that the val matches the format, returning a boolean. Format can be:
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
            return typeof val === format && !(val instanceof Array);
        } else if (typeof format === 'function') { // handle format === Object, MyClass, etc.
            return val instanceof format;
        } else {
            log.warn('Invalid format %1', JSON.stringify(format));
            return true;
        }
    };
    
    /**
     * Check that value fits within several possible limits. cfg should be the config for a field
     * in the schema, containing properties like _min and _max. Returns { isValid: true } if checks
     * pass and { isValid: false, reason: '...' } if some checks fail.
     */
    Model.checkLimits = function(cfg, value, keyStr) {
        if (!cfg) {
            return { isValid: true };
        }
        
        if ('_min' in cfg && value < cfg._min) {
            return {
                isValid: false,
                reason: keyStr + ' must be greater than the min: ' + cfg._min
            };
        }

        if ('_max' in cfg && value > cfg._max) {
            return {
                isValid: false,
                reason: keyStr + ' must be less than the max: ' + cfg._max
            };
        }
        
        if ('_length' in cfg && value.length > cfg._length) {
            return {
                isValid: false,
                reason: keyStr + ' must have less than max entries: ' + cfg._length
            };
        }
        
        if ('_acceptableValues' in cfg && cfg._acceptableValues !== '*' &&
                                          cfg._acceptableValues.indexOf(value) === -1) {
            return {
                isValid: false,
                reason: keyStr + ' is not one of the acceptable values: [' +
                        cfg._acceptableValues.join(',') + ']'
            };
        }
        
        return { isValid: true };
    };

    /**
     * Recursively validates an object using a schema personalized for the requester.
     * - action: 'create' if creating new object, 'edit' if editing exsting
     * - newObj: the req.body, either a new object or set of updates to an existing object
     * - origObj: the existing version of this object, or {} if none exists
     * - requester: the user sending the request.
     * Returns { isValid: true } if all validations pass, { isValid: false, reason: '...' } if
     * validations fail.
     */
    Model.prototype.validate = function(action, newObj, origObj, requester) {
        var self = this,
            log = logger.getLog(),
            actingSchema = self.personalizeSchema(requester),
            failMsg;
            
        // trimming field on a nested object can overwrite in mongo, so take orig val if defined
        function trimField(key, updates, orig) {
            if (orig && orig[key] !== undefined) {
                updates[key] = orig[key];
            } else {
                delete updates[key];
            }
        }

        function validateField(key, schema, updates, orig, keyStr) {
            // fail if field is required and not present in updates or orig
            if (schema[key]._required && (updates[key] === undefined || updates[key] === null)) {
                if (action === 'create') {
                    log.info('Updates does not contain required key "%1"', keyStr);
                    failMsg = 'Missing required field: ' + keyStr;
                    return false;
                } else if (orig[key] !== undefined && orig[key] !== null) {
                    updates[key] = orig[key];
                    return true;
                }
            }
        
            // pass if field not present
            if (updates[key] === undefined) {
                // set default val if defined in schema
                if (schema[key]._default !== undefined && (!orig || !orig[key])) {
                    updates[key] = schema[key]._default;
                }
                return true;
            }
            
            // trim field if forbidden
            if (schema[key]._accessLevel === AccessLevel.Forbidden) {
                log.trace('Updates contains forbidden key "%1", trimming it off', keyStr);
                trimField(key, updates, orig);
                return true;
            }
            
            // trim field if it can only be set on create and this is not create
            if (schema[key]._createOnly && action !== 'create') {
                log.trace('Key "%1" can only be set on create, trimming it off', keyStr);
                trimField(key, updates, orig);
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
            
            // fail if field does not pass limit checks
            var limitResp = Model.checkLimits(schema[key], updates[key], keyStr);
            if (!limitResp.isValid) {
                failMsg = limitResp.reason;
                log.info('Failed limit check: %1', failMsg);
                return false;
            }
            
            return Object.keys(schema[key]).every(function(subKey) {
            
                // if subKey is _entries, validate every entry in updates[key]
                if (subKey === '_entries' && updates[key] instanceof Array) {
                    return updates[key].every(function(entry, idx) {
                        // if entries are objects, recursively call validateField
                        if (objUtils.isPOJO(entry)) {
                            return Object.keys(schema[key][subKey]).every(function(entryField) {
                                return validateField(
                                    entryField,
                                    schema[key][subKey],
                                    entry,
                                    {},
                                    keyStr + '[' + idx + '].' + entryField
                                );
                            });
                        } // otherwise, just call checkLimits with schema's config in _entries
                        else {
                            var limitResp = Model.checkLimits(
                                schema[key][subKey],
                                entry,
                                keyStr + '[' + idx + ']'
                            );
                            
                            if (limitResp.isValid) {
                                return true;
                            } else {
                                failMsg = limitResp.reason;
                                log.info('Failed limit check: %1', failMsg);
                                return false;
                            }
                        }
                    });
                }
                
                // do not recurse for '_' subfields that are part of DSL
                if (/^_.+/.test(subKey)) {
                    return true;
                }
                
                // recursively validate the sub-field
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
    
    /**
     * Middleware usable with the CrudSvc framework for validating: calls model.validate with
     * req.body, req.origObj, and req.user, calling next() if isValid === true and done() if
     * isValid === false. The action should be bound in.
     */
    Model.prototype.midWare = function(action, req, next, done) {
        var self = this;
        
        var validateResp = self.validate(action, req.body, req.origObj || {}, req.user);
        
        if (validateResp.isValid) {
            next();
        } else {
            done({ code: 400, body: validateResp.reason });
        }
    };
        
    module.exports = Model;
}());
