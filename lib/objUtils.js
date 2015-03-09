(function(){
    'use strict';
    
    var objUtils = {};

    // Sort the object by its keys to ensure equal objects are identical once stringified
    objUtils.sortObject = function(obj) {
        var newObj = {};
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }
        if (obj instanceof Array) {
            newObj = [];
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
        if (!obj || typeof obj !== 'object') {
            return;
        }

        Object.keys(obj).forEach(function(key) {
            if (obj[key] === null) {
                delete obj[key];
            } else if (typeof obj[key] === 'object') {
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
    
    // Copy props from newObj to orig if they are undefined in orig
    objUtils.extend = function(orig, newObj) {
        if (orig !== Object(orig) || newObj !== Object(newObj)) { // checks that they are objects
            return orig;
        }
        
        Object.keys(newObj).forEach(function(key) {
            if (orig[key] ===  undefined) {
                orig[key] = newObj[key];
            }
        });
        
        return orig;
    };
    
    module.exports = objUtils;
}());
