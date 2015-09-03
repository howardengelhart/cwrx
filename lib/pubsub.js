(function(){
    'use strict';
    var q           = require('q'),
        net         = require('net'),
        events      = require('events'),
        util        = require('util'),
        logger      = require('./logger'),
        
        pubsub = {};

    /* Creates a server listening on a host + port or Unix socket file. connCfg must be an object
     * with either a path to a socket file or a port number (host is optional and defaults to
     * localhost). When a client connects, the publisher sends it the last message it sent out, and
     * saves the created socket internally. The publisher can then broadcast messages to all
     * clients. */
    pubsub.Publisher = function(name, connCfg) {
        var self = this,
            log = logger.getLog();
            
        if (!connCfg || (!connCfg.port && !connCfg.path)) {
            throw new Error('Must provide a cfg object with port or socket path');
        }
        
        self.name = name;
        self._sockets = [];
        self.lastMsg = '';
        
        self._server = net.createServer();
        
        self._server.on('connection', function(sock) {
            sock._clientAddr = sock.remoteAddress + ':' + sock.remotePort;
            log.info('Publisher %1 got new client %2', self.name, sock._clientAddr);
            self._sockets.push(sock);
            
            log.trace('Publisher %1 sending client %2 last message: %3',
                      self.name, sock._clientAddr, self.lastMsg);
            sock.write(self.lastMsg);
            
            sock.on('end', function() {
                log.info('Client %1 disconnected from publisher %2', sock._clientAddr, self.name);

                self._sockets = self._sockets.filter(function(s) {
                    return s._clientAddr !== sock._clientAddr;
                });
            })
            .on('error', function(err) {
                log.warn('Conn to client %1 for publisher %2 got error: %3',
                         sock._clientAddr, self.name, util.inspect(err));

                sock.end();
                self._sockets = self._sockets.filter(function(s) {
                    return s._clientAddr !== sock._clientAddr;
                });
            });
            
            // sets stream to "flowing mode", so we get an 'end' event, but ignore 'data' events
            sock.resume();
        });

        // Note: if using Unix socket, you must delete file when it's no longer used
        if (connCfg.path) {
            self._server.listen(connCfg.path, function() {
                log.info('Publisher %1 listening for connections on %2', self.name, connCfg.path);
            });
        } else {
            self._server.listen(connCfg.port, connCfg.host, function() {
                log.info('Publisher %1 listening for connections on %2',
                         self.name, connCfg.host || 'localhost', connCfg.port);
            });
        }
    };
    
    // Shut down a publisher, closing the server and all established connections
    pubsub.Publisher.prototype.close = function() {
        var self = this,
            log = logger.getLog();
            
        log.info('Shutting down publisher %1', self.name);
        self._server.close();
        self._sockets.forEach(function(sock) {
            sock.end();
        });
    };

    /* Send a message to all connected clients and save it as lastMsg. The data can be of any type;
     * it will be serialized with JSON.stringify(). If there are no connected clients, this will
     * just save the message internally as lastMsg so newly connecting clients will receive it. */
    pubsub.Publisher.prototype.broadcast = function(data) {
        var self = this,
            log = logger.getLog(),
            str = JSON.stringify(data);
            
        self.lastMsg = str;
        
        if (self._sockets.length === 0) {
            log.info('Publisher %1 broadcasting but has no clients to write to', self.name);
            return q();
        }
        
        log.trace('Publisher %1 broadcasting %2 to %3 clients', self.name,str,self._sockets.length);
        
        return q.all(self._sockets.map(function(sock) {
            return q.npost(sock, 'write', [str])
            .catch(function(error) {
                log.warn('Publisher %1 failed to write to client %2: %3',
                          self.name, sock._clientAddr, util.inspect(error));
                return q.reject('Socket error');
            });
        }));
    };

    /* Connect to a Publisher using a similar connCfg format (port + host or socket path). On
     * receiving data, it will attempt to JSON.parse it, and them emit a 'message' event with the
     * parsed data. If the connection to the Publisher fails (either on the initial connect or at
     * any later time), the Subscriber will enter a polling mode where it will attempt to reconnect
     * every <reconnectDelay> ms.*/
    pubsub.Subscriber = function(name, connCfg, opts) {
        var self = this,
            log = logger.getLog();
        opts = opts || {};

        if (!connCfg || (!connCfg.port && !connCfg.path)) {
            throw new Error('Must provide a cfg object with port or socket path');
        }
        
        self.name = name;
        self.connCfg = connCfg;
        self.reconnect = {
            enabled : opts.reconnect !== undefined ? !!opts.reconnect : true,
            delay   : opts.reconnectDelay || 5000
        };
        self.ping = {
            delay   : opts.pingDelay || 5000
        };
        self.lastMsg = null;
        self.localAddr = '';
        
        self._socket = net.connect(connCfg);
        self._socket.on('connect', function() {
            var addr = self._socket.address();
            self.localAddr = addr.address + ':' + addr.port;
        
            log.info('Subscriber %1 (%2) connected to publisher', self.name, self.localAddr);
            if (self.reconnect._interval) {
                clearInterval(self.reconnect._interval);
                delete self.reconnect._interval;
            }
            
            // This effectively periodically checks that the socket is still working
            self.ping._interval = setInterval(function() {
                self._socket.write('ping');
            }, self.ping.delay);
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
            self.beginReconnect();
        })
        .on('error', function(err) {
            log.warn('Subscriber %1 got error, disconnecting: %2',
                     self.name, util.inspect(err));
            self.beginReconnect();
        });
    };

    util.inherits(pubsub.Subscriber, events.EventEmitter);
    
    // Sets up an interval to attempt to reconnect. This is cancelled on successfully connecting
    pubsub.Subscriber.prototype.beginReconnect = function() {
        var self = this,
            log = logger.getLog();
            
        if (self.ping._interval) {
            clearInterval(self.ping._interval);
            delete self.ping._interval;
        }
            
        if (!self.reconnect.enabled || self.reconnect._interval) {
            return;
        }
        
        self.reconnect._interval = setInterval(function() {
            log.info('Subscriber %1 attempting reconnect to %2',
                     self.name, util.inspect(self.connCfg));
            self._socket.connect(self.connCfg);
        }, self.reconnect.delay);
    };
    
    // Close the socket connection and turn off reconnecting
    pubsub.Subscriber.prototype.close = function() {
        this.reconnect.enabled = false;
        this._socket.end();
    };
    
    module.exports = pubsub;
}());
