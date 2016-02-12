var path = require('path');

module.exports = {
    options: {
        ads: {
            preScripts: [
                {
                    name: 'ensureApps.js',
                    path: path.join(__dirname, '../../scripts/ensureApps.js'),
                    forwardedArgs: ['dbHost']
                }
            ]
        },
        userSvc: {
            preScripts: [
                {
                    name: 'sixxyUser.js',
                    path: path.join(__dirname, '../../scripts/sixxyUser.js'),
                    forwardedArgs: ['dbHost']
                }
            ]
        },
        geo: {
            preScripts: [
                {
                    name: 'loadZipcodes.js',
                    path: path.join(__dirname, '../../scripts/loadZipcodes.js'),
                    forwardedArgs: ['dbHost']
                }
            ]
        }
    }
};
