/*jslint camelcase: false */
(function(){
    'use strict';
    var mongodb = require('mongodb'),
        q       = require('q'),

        mongoUtils = {};

    /* If you pass hosts and replSet, this will connect to the replica set containing all the hosts.
     * Otherwise, it will just connect to the instance specified by host and port.
     * Hosts should be an array of the form ['host1:port1', 'host2:port2', ...] */
    mongoUtils.connect = function(host, port, db, username, password, hosts, replSet) {
        if (!db || (!(host && port) && !(hosts && replSet)) ) {
            return q.reject('Must pass db and either host+port or hosts+replSet');
        }

        var userString = (username && password) ? username + ':' + password + '@' : '';
        var url = 'mongodb://' + userString;
        if (hosts && replSet) {
            url += hosts.join(',') + '/' + db + '?replicaSet=' + replSet;
        } else {
            url += host + ':' + port + '/' + db;
        }
        var opts = {
            server: { auto_reconnect: true },
            db: { native_parser: true, bufferMaxEntries: 0 }
        };
        return q.npost(mongodb.MongoClient, 'connect', [url, opts]);
    };

    /* Return a copy of the user object with sensitive fields removed, safe for sending
     * to the client.  This should be updated any time code is added that will add sensitive
     * properties to the user object */
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
