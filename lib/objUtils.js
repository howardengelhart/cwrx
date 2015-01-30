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
    
    module.exports = objUtils;
}());
