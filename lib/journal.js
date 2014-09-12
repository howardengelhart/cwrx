(function(){
    'use strict';

    var q           = require('q'),
        util        = require('util'),
        mongoUtils  = require('../lib/mongoUtils'),
        logger      = require('../lib/logger');

    // TODO: comments
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

    Journal.prototype.write = function(user, origin, data) {
        var log = logger.getLog(),
            self = this,
            record = {
                user: user,
                created: new Date(),
                host: self.host,
                pid: process.pid,
                service: self.svcName,
                version: self.version,
                origin: origin,
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
    
    var AuditJournal = function() {
        Journal.apply(this, arguments);
    };
    
    util.inherits(AuditJournal, Journal);

    //TODO: especially explain this    
    AuditJournal.prototype.writeAuditEntry = function(req, userId) {
        var params = {},
            origin = req.headers && (req.headers.origin || req.headers.referer) || '',
            self = this;
        
        // req.params is weirdly not a normal object/array, so convert it to something sensible
        Object.keys(req.params).forEach(function(key) {
            params[key] = req.params[key];
        });

        var data = {
            route: req.route.method.toUpperCase() + ' ' + req.route.path,
            params: params,
            query: req.query
        };
        
        return self.write(userId, origin, data);
    };

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
