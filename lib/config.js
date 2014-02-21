(function(){
    'use strict';
        
    var fs     = require('fs-extra');

    function createConfigObject(cfgPath, defaultCfg) {
        var cfgObject = {},
            userCfg = {};
        
        if (cfgPath) {
            userCfg = fs.readJsonSync(cfgPath, { encoding : 'utf8' });
        }

        if (!defaultCfg) {
            return userCfg;
        }
       
        Object.keys(defaultCfg).forEach(function(section){
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
        
        return cfgObject;
    }

    module.exports.createConfigObject = createConfigObject;
}());
