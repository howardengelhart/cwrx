(function(){
    'use strict';
    
    var objUtils = {};
    
    objUtils.isPOJO = function(value) {
        return !!(value && value.constructor === Object);
    };

    objUtils.filter = function filter(object, predicate) {
        return Object.keys(object).reduce(function(result, key, index) {
            if (predicate(object[key], key, index, object)) {
                result[key] = object[key];
            }

            return result;
        }, {});
    };

    // Sort the object by its keys to ensure equal objects are identical once stringified
    objUtils.sortObject = function(obj) {
        var newObj = {};

        if (obj instanceof Array) {
            newObj = [];
        } else if (!objUtils.isPOJO(obj)) {
            return obj;
        }

        Object.keys(obj).sort().forEach(function(key) {
            newObj[key] = objUtils.sortObject(obj[key]);
        });
        return newObj;
    };

    // Deep equality check for two objects, using stringification
    objUtils.compareObjects = function(a, b) {
        return JSON.stringify(objUtils.sortObject(a)) === JSON.stringify(objUtils.sortObject(b));
    };
    
    // Trims out an fields with null values from an object
    objUtils.trimNull = function(obj) {
        if (!objUtils.isPOJO(obj)) {
            return;
        }

        Object.keys(obj).forEach(function(key) {
            if (obj[key] === null) {
                delete obj[key];
            } else if (objUtils.isPOJO(obj[key])) {
                objUtils.trimNull(obj[key]);
            }
        });
    };
    
    /* Returns true if all elements of list are distinct, false otherwise. No special handling for
     * lists of objects (every list of objects will be considered distinct). */
    objUtils.isListDistinct = function(list) {
        return !(list instanceof Array) || list.every(function(item, idx) {
            if (list.indexOf(item) !== idx) { // aka there's another instance of item in list
                return false;
            }
            return true;
        });
    };
    
    /* Recursively copy props from newObj to orig if undefined in orig. Copies all props by value,
     * so there are no shared references between orig and newObj. */
    objUtils.extend = function(orig, newObj) {
        if (!orig || (!objUtils.isPOJO(newObj) && !(newObj instanceof Array))) {
            return orig;
        }
        
        Object.keys(newObj).forEach(function(key) {
            if (objUtils.isPOJO(newObj[key])) {
                orig[key] = orig[key] || {};
                objUtils.extend(orig[key], newObj[key]);
            } else if (newObj[key] instanceof Array) {
                orig[key] = orig[key] || [];
                objUtils.extend(orig[key], newObj[key]);
            } else if (orig[key] ===  undefined) {
                orig[key] = newObj[key];
            }
        });
        
        return orig;
    };
    
    module.exports = objUtils;
}());
