(function(){
    'use strict';
        
    var fs     = require('fs-extra'),
        config = {};

    config.mergeObjects = function(a, b) {
        var newObj = {};

        if (a === undefined || a === null) {
            return b;
        }
        if (b === undefined || b === null) {
            return a;
        }
        if (typeof a !== 'object' || typeof b !== 'object' ||
            a instanceof Date || b instanceof Date) {
            return b;
        }
        
        if (a instanceof Array || b instanceof Array) {
            if (a instanceof Array && b instanceof Array) {
                newObj = [];
            } else {
                return b;
            }
        }
        
        Object.keys(a).forEach(function(section) {
            newObj[section] = config.mergeObjects(a[section], b[section]);
        });
        Object.keys(b).forEach(function(section) {
            if (!a[section]) { // just need to copy keys of b not in a
                newObj[section] = b[section];
            }
        });
        
        return newObj;
    };

    config.createConfigObject = function(cfgPath, defaultCfg) {
        var userCfg = {};
        
        if (cfgPath) {
            userCfg = fs.readJsonSync(cfgPath, { encoding : 'utf8' });
        }

        if (!defaultCfg) {
            return userCfg;
        }

        return config.mergeObjects(defaultCfg, userCfg);
    };

    module.exports = config;
}());
