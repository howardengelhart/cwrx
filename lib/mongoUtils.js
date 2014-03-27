/*jslint camelcase: false */
(function(){
    'use strict';
    var mongodb = require('mongodb'),
        q       = require('q'),

        mongoUtils = {};

    mongoUtils.connect = function(host, port, db, username, password) {
        if (!host || !port || !db) {
            return q.reject('Must pass host, port, and db as params to mongoUtils.connect');
        }
        var userString = (username && password) ? username + ':' + password + '@' : '';
        var url = 'mongodb://' + userString + host + ':' + port + '/' + db;
        var opts = { db: {native_parser: true, bufferMaxEntries: 0} };
        return q.npost(mongodb.MongoClient, 'connect', [url, opts]);
    };

    // Return a copy of the user object with sensitive fields removed, safe for sending
    // to the client.  This should be updated any time code is added that will add sensitive
    // properties to the user object
    mongoUtils.safeUser = function(user) {
        var newUser = {};
        for (var key in user) {
            if (key !== 'password') {
                newUser[key] = user[key];
            }
        }
        return newUser;
    };

    module.exports = mongoUtils;
}());
