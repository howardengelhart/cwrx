(function(){
    'use strict';
    var pg          = require('pg.js'),
        util        = require('util'),
        q           = require('q'),
        logger      = require('./logger'),
        dbpass      = require('./dbpass'),

        pgUtils = {};

    function ServiceError(message, status) {
        Error.call(this, message);

        this.message = message;
        this.status = status;
    }
    util.inherits(ServiceError, Error);

    ServiceError.prototype.toString = function toString() {
        return '[' + this.status + '] ' + this.message;
    };

    // Set the initial config of the postgres connection
    pgUtils.initConfig = function(state) {
        var lookup = dbpass.open(),
            log = logger.getLog();

        ['database','host','user'].forEach(function(key){
            if (!(!!state.config.pg.defaults[key])){
                throw new Error('Missing configuration: pg.defaults.' + key);
            } else {
                pg.defaults[key] = state.config.pg.defaults[key];
            }
        });

        ['port','poolSize','poolIdleTimeout','reapIntervalMillis'].forEach(function(key){
            if (state.config.pg.defaults[key]) {
                pg.defaults[key] = state.config.pg.defaults[key];
            }
        });

        pg.defaults.password = lookup(
            pg.defaults.host,
            pg.defaults.port,
            pg.defaults.database,
            pg.defaults.user
        );

        pg.on('error',function(e){
            log.error('pg-error: %1', e.message);
        });

        return state;
    };

    // Open a connection to postgres + execute the query statement with the given params
    pgUtils.query = function(statement, params) {
        var deferred = q.defer(),
            log = logger.getLog();

        pg.connect(function(err, client, done) {
            if (err) {
                log.error('pg.connect error: %1', err.message);
                return deferred.reject(new ServiceError('Internal Error', 500));
            }

            client.query(statement,params,function(err, result) {
                done();
                if (err) {
                    log.error('pg.client.query error: %1, %2, %3', err.message, statement, params);
                    deferred.reject(new ServiceError('Internal Error', 500));
                } else {
                    deferred.resolve(result);
                }
            });
        });

        return deferred.promise;
    };

    module.exports = pgUtils;
}());

