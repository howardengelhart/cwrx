(function(){
    'use strict';
    var mongodb     = require('mongodb'),
        urlUtils    = require('url'),
        util        = require('util'),
        q           = require('q'),
        logger      = require('./logger'),

        mongoUtils = {};

    /**
     * If you pass hosts and replSet, this will connect to the replica set containing all the hosts.
     * Otherwise, it will just connect to the instance specified by host and port.
     * Hosts should be an array of the form ['host1:port1', 'host2:port2', ...]
     */
    mongoUtils.connect = function(host, port, db, username, password, hosts, replSet) {
        hosts = hosts && hosts instanceof Array && hosts.length !== 0 ? hosts : null;
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
            server: { autoReconnect: true },
            db: { bufferMaxEntries: 0 }
        };
        return mongodb.MongoClient.connect(urlUtils.format(urlObj), opts);
    };

    /**
     * Return a copy of the user object with sensitive fields removed, safe for sending
     * to the client.  This should be updated any time code is added that will add sensitive
     * properties to the user object.  This also calls mongoUtils.unescapeKeys for convenience.
     */
    mongoUtils.safeUser = function(user) {
        if (!user || typeof user !== 'object') {
            return user;
        }
        var newUser = {};
        for (var key in user) {
            if (key !== 'password' && key !== '_id' && key !== 'resetToken' &&
                key !== 'activationToken') {
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
            if (obj[key] !== undefined) {
                var newKey = key.replace(/\./g, String.fromCharCode(65294))
                                .replace(/^\$/, String.fromCharCode(65284));
                newObj[newKey] = mongoUtils.escapeKeys(obj[key]);
            }
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
    
    // Merge a new orClause (format: {$or: [expr1, ...] }) into an existing query
    mongoUtils.mergeORQuery = function(query, orClause) {
        if (!orClause || !(orClause.$or instanceof Array) || orClause.$or.length === 0) {
            return query;
        }
    
        if (query.$and) {
            query.$and.push(orClause);
        } else if (query.$or) {
            query.$and = [];
            query.$and.push({ $or: query.$or }, orClause);
            delete query.$or;
        } else {
            query.$or = orClause.$or;
        }
        
        return query;
    };

    // Find a single object by id. A replacement for deprecated collection.findOne() method
    mongoUtils.findObject = function(coll, query) {
        return q(coll.find(query, { limit: 1 }).next());
    };

    // Insert obj into the provided collection.
    mongoUtils.createObject = function(coll, obj) {
        delete obj._id;

        var log = logger.getLog(),
            escaped = mongoUtils.escapeKeys(obj),
            opts = { w: 1, journal: true };
        
        // Mongo methods return promises, so we convert them to q promises
        return q(coll.insertOne(escaped, opts))
        .then(function() {
            log.info('Created object %1', escaped.id);
            return q(escaped);
        })
        .catch(function(err) {
            log.error('Failed inserting object %1: %2', escaped.id, util.inspect(err));
            return q.reject(err);
        });
    };

    /* Edit entity with the provided id in the collection. Will modify every field defined in obj,
     * leaving all other fields on the entity alone. */
    mongoUtils.editObject = function(coll, obj, id) {
        delete obj._id;
        obj.lastUpdated = new Date();

        var log = logger.getLog(),
            updateObj = { $set: mongoUtils.escapeKeys(obj) },
            //TODO: double check write concern? use w: 'majority', and should it just be 'j'?
            opts = { w: 1, journal: true, returnOriginal: false, sort: { id: 1 } };

        return q(coll.findOneAndUpdate({ id: id }, updateObj, opts))
        .then(function(result) {
            var updated = result.value;
            log.info('Edited object %1', updated.id);
            return q(updated);
        })
        .catch(function(err) {
            log.error('Failed editing object %1: %2', id, util.inspect(err));
            return q.reject(err);
        });
    };

    module.exports = mongoUtils;
}());
