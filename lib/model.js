(function(){
    'use strict';

    var logger      = require('./logger'),
        objUtils    = require('./objUtils');

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
     * - All `__type` properties in the schema are preserved.
     * - Any config block in the schema with `__locked = true` will not be changed at all.
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
                // don't overwrite fields in self.schema that are __locked
                if (target[key] && target[key].__locked) {
                    return;
                }

                // never overwrite __type properties from self.schema
                if (key === '__type' && target[key] !== undefined) {
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

        // if format is a simple type string, check typeof val
        if (['string', 'number', 'boolean', 'object'].indexOf(format) !== -1) {
            return typeof val === format && !(val instanceof Array);
        }

        if (format === 'Date') {
            return val instanceof Date;
        }

        // if format is 'xxxArray', check that val is array & all entries match 'xxx'
        if (/.+Array$/.test(format)) {
            var subFormat = format.replace(/Array$/, '');
            return val instanceof Array && val.every(function(item) {
                return Model.checkFormat(subFormat, item);
            });
        }

        log.warn('Invalid format %1', JSON.stringify(format));
        return true;
    };

    /**
     * Check that value fits within several possible limits. cfg should be the config for a field
     * in the schema, containing properties like __min and __max. Returns { isValid: true } if
     * checks pass and { isValid: false, reason: '...' } if some checks fail.
     */
    Model.checkLimits = function(cfg, value, keyStr) {
        if (!cfg) {
            return { isValid: true };
        }

        if ('__min' in cfg && value < cfg.__min) {
            return {
                isValid: false,
                reason: keyStr + ' must be greater than the min: ' + cfg.__min
            };
        }

        if ('__max' in cfg && value > cfg.__max) {
            return {
                isValid: false,
                reason: keyStr + ' must be less than the max: ' + cfg.__max
            };
        }

        if ('__length' in cfg && value.length > cfg.__length) {
            return {
                isValid: false,
                reason: keyStr + ' must have at most ' + cfg.__length + ' entries'
            };
        }

        if ('__acceptableValues' in cfg && cfg.__acceptableValues !== '*' &&
                                           cfg.__acceptableValues.indexOf(value) === -1) {
            return {
                isValid: false,
                reason: keyStr + ' is UNACCEPTABLE! acceptable values are: [' +
                        cfg.__acceptableValues.join(',') + ']'
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

        // replace user-defined val with orig, default, or undefined
        function replaceField(key, schema, updates, orig) {
            if (orig && orig[key] !== undefined) {
                updates[key] = orig[key];
            } else if (schema[key].__default !== undefined) {
                updates[key] = schema[key].__default;
            } else {
                delete updates[key];
            }
        }

        function validateField(key, schema, updates, orig, keyStr) {
            // fail if field is required and not present (undefined or null) in updates or orig
            if (schema[key].__required && (updates[key] === undefined || updates[key] === null)) {
                if (orig[key] === undefined || orig[key] === null) {
                    log.info('Updates does not contain required key "%1"', keyStr);
                    failMsg = 'Missing required field: ' + keyStr;
                    return false;
                } else { // ensure required field is not unset
                    updates[key] = orig[key];
                    return true;
                }
            }
            
            // allow null as a value, and do not continue validating
            if (updates[key] === null) {
                return true;
            }

            // pass if field not present
            if (updates[key] === undefined || updates[key] === null) {
                delete updates[key];

                // set default val if defined in schema
                if (schema[key].__default !== undefined && (!orig || !orig[key])) {
                    updates[key] = schema[key].__default;
                }
                return true;
            }

            // trim field if forbidden
            if (schema[key].__allowed === false) {
                log.trace('Updates contains forbidden key "%1", trimming it off', keyStr);
                replaceField(key, schema, updates, orig);
                return true;
            }

            // trim field if it is unchangeable and has been set on orig
            if (schema[key].__unchangeable && (orig[key] !== undefined && orig[key] !== null)) {
                log.trace('Key "%1" can only be set once, trimming it off', keyStr);
                replaceField(key, schema, updates, orig);
                return true;
            }

            // try to cast date strings to Date objects, if __type specifies Date
            if (schema[key].__type === 'Date' && typeof updates[key] === 'string') {
                var casted = new Date(updates[key]);
                if (casted.toString() !== 'Invalid Date') {
                    updates[key] = casted;
                }
            }

            // fail if field is wrong type
            if (!Model.checkFormat(schema[key].__type, updates[key])) {
                log.info('Updates contains key "%1" in wrong format', keyStr);
                failMsg = keyStr + ' must be in format: '+ schema[key].__type;
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

                // if subKey is __entries, validate every entry in updates[key]
                if (subKey === '__entries' && updates[key] instanceof Array) {
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
                        } // otherwise, just call checkLimits with schema's config in __entries
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

                // do not recurse for '__' subfields that are part of DSL
                if (/^__.+/.test(subKey)) {
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
