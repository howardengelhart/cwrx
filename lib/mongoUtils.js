/*jslint camelcase: false */
(function(){
    'use strict';
    var mongodb = require('mongodb'),
        url     = require('url'),
        q       = require('q'),

        mongoUtils = {};

    /**
     * If you pass hosts and replSet, this will connect to the replica set containing all the hosts.
     * Otherwise, it will just connect to the instance specified by host and port.
     * Hosts should be an array of the form ['host1:port1', 'host2:port2', ...]
     */
    mongoUtils.connect = function(host, port, db, username, password, hosts, replSet) {
        if (!db || (!(host && port) && !(hosts && hosts.length > 0 && replSet)) ) {
            return q.reject('Must pass db and either host+port or hosts+replSet');
        }

        var urlObj = {
            protocol: 'mongodb',
            slashes: true,
            host: hosts ? hosts.join(',') : host + ':' + port,
            pathname: db,
            query: { readPreference: 'primaryPreferred' }
        };
        if (replSet) {
            urlObj.query.replicaSet = replSet;
        }
        if (username && password) {
            urlObj.auth = username + ':' + password;
        }
        
        var opts = {
            server: { auto_reconnect: true },
            db: { native_parser: true, bufferMaxEntries: 0 }
        };
        return q.npost(mongodb.MongoClient, 'connect', [url.format(urlObj), opts]);
    };

    /**
     * Return a copy of the user object with sensitive fields removed, safe for sending
     * to the client.  This should be updated any time code is added that will add sensitive
     * properties to the user object.  This also calls mongoUtils.unescapeKeys for convenience.
     */
    mongoUtils.safeUser = function(user) {
        var newUser = {};
        for (var key in user) {
            if (key !== 'password' && key !== '_id' && key !== 'resetToken') {
                newUser[key] = user[key];
            }
        }
        return mongoUtils.unescapeKeys(newUser);
    };

    /**
     * When writing objects to the database, Mongo forbids the use of '$' characters at the
     * beginning of any of the object's keys, as well as '.' characters anywhere in the keys.  This
     * method goes through an object and replaces these characters with their Unicode full-width
     * equivalents.  It should be called whenever writing user-provided input to the database.
     */
    mongoUtils.escapeKeys = function(obj) {
        if (typeof obj !== 'object' || obj === null || obj instanceof Date) {
            return obj;
        }
        var newObj = {};
        if (obj instanceof Array) {
            newObj = [];
        }
        Object.keys(obj).forEach(function(key) {
            var newKey = key.replace(/\./g, String.fromCharCode(65294))
                            .replace(/^\$/, String.fromCharCode(65284));
            newObj[newKey] = mongoUtils.escapeKeys(obj[key]);
        });
        return newObj;
    };
    
    /**
     * This method performs the opposite replacements of the above method, and should be used
     * whenever returning objects from the database.
     */
    mongoUtils.unescapeKeys = function(obj) {
        if (typeof obj !== 'object' || obj === null || obj instanceof Date) {
            return obj;
        }
        var newObj = {};
        if (obj instanceof Array) {
            newObj = [];
        }
        Object.keys(obj).forEach(function(key) {
            var newKey = key.replace(new RegExp(String.fromCharCode(65294), 'g'), '.')
                            .replace(new RegExp('^' + String.fromCharCode(65284)), '$');
            newObj[newKey] = mongoUtils.unescapeKeys(obj[key]);
        });
        return newObj;
    };

    module.exports = mongoUtils;
}());
