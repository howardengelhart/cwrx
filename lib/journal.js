(function(){
    'use strict';

    var q           = require('q'),
        util        = require('util'),
        mongoUtils  = require('../lib/mongoUtils'),
        logger      = require('../lib/logger');

    // TODO: comments
    var Journal = function(coll) {
        var self = this,
            log = logger.getLog();
        if (!coll) {
            throw new Error('Must provide a collection!');
        }

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
    
    Journal.prototype.write = function(user, data) {
        var log = logger.getLog(),
            self = this,
            record = {
                user: user,
                created: new Date(),
                data: mongoUtils.escapeKeys(data)
            };
        return q.npost(self._coll, 'insert', [record, {w: 1, journal: true}])
        .then(function() {
            log.trace('Successfully wrote event from user %1 to %2 journal', user, self.name);
            return q();
        }).catch(function(error) {
            log.warn('Error writing event from user %1 to %2 journal: %3',
                     user, self.name, util.inspect(error));
            return q.reject(error);
        });
    };
    
    var AuditJournal = function(coll) {
        Journal.call(this, coll);
    };
    
    util.inherits(AuditJournal, Journal);

    //TODO: if req.session.user is invalid or inactive user id, will still log...
    AuditJournal.prototype.middleware = function(req, res, next) {
        var log = logger.getLog(),
            params = {},
            self = this;
        if (!req.user) {
            log.trace('[%1] No user logged in, so not writing to audit log', req.uuid);
            return next();
        }
        
        // req.params is weirdly not a normal object/array, so convert it to something sensible
        Object.keys(req.params).forEach(function(key) {
            params[key] = req.params[key];
        });

        var data = {
            route: req.route.method.toUpperCase() + ' ' + req.route.path, //TODO: break out method?
            params: params, //TODO: include these + query if empty?
            query: req.query
        };
        
        self.write(req.user.id, data);
        
        next();
    };

    module.exports = {
        Journal: Journal,
        AuditJournal: AuditJournal
    };
}());
