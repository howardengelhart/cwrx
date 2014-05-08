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
        if (typeof a !== 'object' || typeof b !== 'object') {
            return b;
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
       
        /*Object.keys(defaultCfg).forEach(function(section){
            if (typeof defaultCfg[section] !== 'object') {
                cfgObject[section] = defaultCfg[section];
                return;
            }
            cfgObject[section] = {};
            Object.keys(defaultCfg[section]).forEach(function(key){
                cfgObject[section][key] = defaultCfg[section][key];
            });
        });

        Object.keys(userCfg).forEach(function(section){
            if (typeof userCfg[section] !== 'object') {
                cfgObject[section] = userCfg[section];
                return;
            }
            if (cfgObject[section] === undefined){
                cfgObject[section] = {};
            }
            Object.keys(userCfg[section]).forEach(function(key){
                cfgObject[section][key] = userCfg[section][key];
            });
        });

        if (userCfg.log) {
            if (!cfgObject.log) {
                cfgObject.log = {};
            }
            Object.keys(userCfg.log).forEach(function(key){
                cfgObject.log[key] = userCfg.log[key];
            });
        }
        
        if (userCfg.hostname) {
            cfgObject.hostname = userCfg.hostname;
        }
        
        return cfgObject;*/
        return config.mergeObjects(defaultCfg, userCfg);
    };

    module.exports = config;
}());
