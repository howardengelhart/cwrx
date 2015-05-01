/*jslint camelcase: false */
(function(){
    'use strict';
    var q           = require('q'),
        net         = require('net'),
        events      = require('events'),
        util        = require('util'),
        logger      = require('./logger'),
        
        pubsub = {};


    pubsub.Publisher = function(name, connCfg) {
        var self = this,
            log = logger.getLog();
            
        if (!connCfg || (!connCfg.port && !connCfg.path)) {
            throw new Error('Must provide a cfg object with port or socket path');
        }
        
        self.name = name;
        self.connCfg = connCfg;
        self._sockets = [];
        self.clientId = 0; // increments on client connect, used for giving sockets helpful ids
        self.lastMsg = '';
        
        self._server = net.createServer();
        
        self._server.on('connection', function(c) {
            c._id = ++self.clientId;
            log.info('Publisher %1 got new client #%2', self.name, c._id);
            self._sockets.push(c);
            
            log.trace('Publisher %1 sending client #%2 last message: %3',
                      self.name, c._id, self.lastMsg);
            c.write(self.lastMsg);
            
            c.on('end', function() {
                log.info('Client #%1 disconnected from publisher %2', c._id, self.name);
                self._sockets = self._sockets.filter(function(sock) {
                    return sock._id !== c._id;
                });
            })
            .on('error', function(err) {
                log.warn('Conn to client #%1 for publisher %2 got error: %3',
                         c._id, self.name, util.inspect(err));
                c.end();
            });
        });

        // Listening on Unix socket is supported; client must handle deleting socket file when done
        if (self.connCfg.path) {
            self._server.listen(connCfg.path, function() {
                log.info('Publisher %1 listening for connections on %2', self.name, connCfg.path);
            });
        } else {
            self._server.listen(connCfg.port, connCfg.host, function() {
                log.info('Publisher %1 listening for connections on %2:%3',
                         self.name, connCfg.host || 'localhost', connCfg.port);
            });
        }
    };

    pubsub.Publisher.prototype.close = function() {
        var self = this,
            log = logger.getLog();
            
        log.info('Shutting down publisher %1', self.name);
        self._server.close();
        self._sockets.forEach(function(sock) {
            sock.end();
        });
    };

    pubsub.Publisher.prototype.broadcast = function(data) {
        var self = this,
            log = logger.getLog(),
            str = JSON.stringify(data);
            
        self.lastMsg = str;
        
        if (self._sockets.length === 0) {
            log.info('Publisher %1 broadcasting but has no clients to write to', self.name);
            return q();
        }
        
        log.trace('Publisher %1 broadcasting %2', self.name, str);
        
        return q.all(self._sockets.map(function(sock) {
            return q.npost(sock, 'write', [str])
            .catch(function(error) {
                log.error('Publisher %1 failed to write to client #%2: %3',
                          self.name, sock._id, util.inspect(error));
                return q.reject('Socket error');
            });
        }));
    };
    
    pubsub.Subscriber = function(name, connCfg, reconnectDelay) {
        var self = this,
            log = logger.getLog();
        
        self.name = name;
        self.connCfg = connCfg;
        self.reconnectDelay = reconnectDelay || 5000;
        self.isConnected = false;
        self.lastMsg = null;
        
        self._socket = net.connect(connCfg);
        self._socket.on('connect', function() {
            log.info('Subscriber %1 connected to publisher', self.name);
            self.isConnected = true;
            if (self._pollInterval) {
                clearInterval(self._pollInterval);
                delete self._pollInterval;
            }
        })
        .on('data', function(data) {
            var str = data.toString(),
                parsed;
            
            try {
                parsed = JSON.parse(str);
            } catch(e) {
                parsed = str;
            }
            
            self.lastMsg = parsed;
            self.emit('message', parsed);
        })
        .on('end', function() {
            log.info('Subscriber %1 disconnected from publisher', self.name);
            self.isConnected = false;
            self.enableConnPoll();
        })
        .on('error', function(err) {
            log.warn('Subscriber %1 got error, disconnecting: %2', self.name, util.inspect(err));
            self.isConnected = false;
            self.enableConnPoll();
        });
    };

    util.inherits(pubsub.Subscriber, events.EventEmitter);
    
    pubsub.Subscriber.prototype.enableConnPoll = function() {
        var self = this,
            log = logger.getLog();
            
        if (self._pollInterval) {
            return;
        }
        
        self._pollInterval = setInterval(function() {
            log.info('Subscriber %1 attempting reconnect to %2',
                     self.name, util.inspect(self.connCfg));
            self._socket.connect(self.connCfg);
        }, self.reconnectDelay);
    };
    
    module.exports = pubsub;
}());
