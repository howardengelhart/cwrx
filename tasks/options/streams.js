'use strict';

var watchmanUser = process.env.WATCHMAN_USER || process.env.USER || 'anon';
var baseStreamNames = [
    'devTimeStream',
    'devWatchmanStream',
    'devCwrxStream'];
var baseTableNames = [
    'devTimeStreamApplication',
    'devWatchmanStreamApplication',
    'devCwrxStreamApplication'
];

module.exports = {
    options: {
        waitTime: 5000,
        streams: baseStreamNames.map(function(name) {
            return name + '-' + watchmanUser;
        }),
        tables: baseTableNames.map(function(name) {
            return name + '-' + watchmanUser;
        })
    },
    create: { },
    destroy: { }
};
