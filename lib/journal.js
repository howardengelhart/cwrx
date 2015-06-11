(function(){
    'use strict';

    var q           = require('q'),
        path        = require('path'),
        util        = require('util'),
        mongoUtils  = require('../lib/mongoUtils'),
        logger      = require('../lib/logger');

    /**
     * Will write journal entries to coll, a collection in mongo. It expects the collection to be
     * capped, and will log a warning if it is not. version should be the service's version string,
     * and svcName should be the service's name (state.config.appName).
     */
    var Journal = function(coll, version, svcName) {
        var self = this,
            getHostname = require('../lib/hostname'),
            log = logger.getLog();
        if (!coll) {
            throw new Error('Must provide a collection!');
        }
        
        self.svcName = svcName;
        self.version = version;
        self._coll = coll;
        self.name = coll.collectionName;
        
        getHostname(true).catch(function() {
            return getHostname(); //attempt to get fqdn, if not get regular hostname
        }).then(function(host) {
            self.host = host;
        }).catch(function(error) {
            log.warn('Couldn\'t get hostname: %1', util.inspect(error));
        });
        
        q.npost(coll, 'isCapped').then(function(result) {
            if (!result) {
                log.warn('Collection %1 is not capped', self.name);
            }
        }).catch(function(error) {
            log.warn('Can\'t check if collection %1 is capped: %2', self.name, util.inspect(error));
        });
    };
    
    // Reset the journal's internal collection object; useful if database reconnects
    Journal.prototype.resetColl = function(coll) {
        var self = this,
            log = logger.getLog();

        self._coll = coll;
        self.name = coll.collectionName;
        q.npost(coll, 'isCapped').then(function(result) {
            if (!result) {
                log.warn('Collection %1 is not capped', self.name);
            }
        }).catch(function(error) {
            log.warn('Can\'t check if collection %1 is capped: %2', self.name, util.inspect(error));
        });
    };

    /**
     * Write a new entry to the collection. Will reject if the call to mongo fails, but takes care
     * of logging the error here, so generally you should ignore the rejected promise.
     */
    Journal.prototype.write = function(user, req, data) {
        var log = logger.getLog(),
            origin = req.headers && (req.headers.origin || req.headers.referer),
            self = this,
            record = {
                user: user,
                created: new Date(),
                host: self.host,
                pid: process.pid,
                uuid: req.uuid,
                sessionID: req.sessionID,
                service: self.svcName,
                version: self.version,
                origin: origin ? String(origin) : undefined,
                data: mongoUtils.escapeKeys(data)
            };

        return q.npost(self._coll, 'insert', [record, {w: 1, journal: true}])
        .then(function() {
            log.trace('Successfully wrote event from user %1 to %2 journal', user, self.name);
            return q();
        })
        .catch(function(error) {
            log.warn('Error writing event from user %1 to %2 journal: %3',
                     user, self.name, util.inspect(error));
            return q.reject(error);
        });
    };
    
    /**
     * A special journal used for logging metdata about each request. Generally, the middleware
     * function should be used and inserted into the route handlers for each route that requires
     * authentication.
     */
    var AuditJournal = function() {
        Journal.apply(this, arguments);
    };
    
    util.inherits(AuditJournal, Journal);

    /**
     * Generally, you should not call this directly, and should use middleware instead. However,
     * for some routes where audit logging is desired but the user will not be stored at req.user,
     * this should be called directly to provide the user id from another source.
     */
    AuditJournal.prototype.writeAuditEntry = function(req, userId) {
        var params = {},
            self = this;
        
        // req.params is weirdly not a normal object/array, so convert it to something sensible
        Object.keys(req.params).forEach(function(key) {
            params[key] = req.params[key];
        });

        var data = {
            route: req.method.toUpperCase() + ' ' + path.join(req.baseUrl, req.route.path),
            params: params,
            query: req.query
        };
        
        return self.write(userId, req, data);
    };

    /**
     * Connect-style middleware that will call writeAuditEntry for each request, and then call next.
     * The call to writeAuditEntry is non-blocking and the request will not wait for it to complete
     * or fail if the write to mongo fails.
     */
    AuditJournal.prototype.middleware = function(req, res, next) {
        var log = logger.getLog(),
            self = this;
        if (!req.user) {
            log.trace('[%1] No user logged in, so not writing to audit log', req.uuid);
            return next();
        }
        
        self.writeAuditEntry(req, req.user.id);
        
        next();
    };

    module.exports = {
        Journal: Journal,
        AuditJournal: AuditJournal
    };
}());
