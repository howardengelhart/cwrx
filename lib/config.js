var fs     = require('fs-extra');

function createConfigObject(cfgPath, defaultCfg) {
    var cfgObject = {},
        userCfg = {};
    
    if (cfgPath) {
        userCfg = fs.readJSONSync(cfgPath, { encoding : 'utf8' });
    }

    if (!defaultCfg) {
        return userCfg;
    }
    
    Object.keys(defaultCfg).forEach(function(section){
        if (typeof defaultCfg[section] !== 'object') {
            if (!userCfg[section] && (userCfg[section] !== undefined)) {
                cfgObject[section] = userCfg[section];
            } else {
                cfgObject[section] = defaultCfg[section];
            }
            return;
        }
        cfgObject[section] = {};
        Object.keys(defaultCfg[section]).forEach(function(key){
            if ((cfgObject[section] !== undefined) && userCfg[section] &&
                (userCfg[section][key] !== undefined)){
                cfgObject[section][key] = userCfg[section][key];
            } else {
                cfgObject[section][key] = defaultCfg[section][key];
            }
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
    
    return cfgObject;
}

module.exports.createConfigObject = createConfigObject;
