/*jslint camelcase: false */
(function(){
    'use strict';
    var q           = require('q'),
        net         = require('net'),
        events      = require('events'),
        util        = require('util'),
        logger      = require('./logger'),
        
        pubsub = {};

    //TODO: everything here is TODO
    pubsub.Publisher = function(name, connCfg) {
        var self = this,
            log = logger.getLog();
            
        if (!connCfg || (!connCfg.port && !connCfg.path)) {
            throw new Error('Must provide a cfg object with port or socket path');
        }
        
        self.name = name;
        self.connCfg = connCfg;
        self._sockets = [];
        self.clientId = 0; // increments on client connect, used for giving clients helpful ids
        self.lastMsg = '';
        
        self._server = net.createServer();
        
        self._server.on('connection', function(c) {
            c._id = ++self.clientId;
            log.info('Publisher %1 got new client #%2', self.name, c._id);
            self._sockets.push(c);
            
            log.trace('Publisher %1 sending client #%2 last message: %3',
                      self.name, c._id, self.lastMsg);
            c.write(self.lastMsg);
            
            /* I don't think we'll actually need this
            c.on('data', function() {
                log.trace('Publisher %1 got ping from client #%2, sending %3',
                          self.name, c._id, self.lastMsg);
                c.write(self.lastMsg);
            })
            */
            c.on('end', function() {
                log.info('Client #%1 disconnected from publisher %2', c._id, self.name);
                self._sockets = self._sockets.filter(function(sock) {
                    return sock._id !== c._id;
                });
            })
            .on('error', function(err) {
                log.warn('Conn to client #%1 for publisher %2 got error: %3', //TODO: log level?
                         c._id, self.name, util.inspect(err));
                c.end();
                //TODO: might want to actually remove socket here? not sure...
            });
        });

        if (self.connCfg.path) {
            self._server.listen(connCfg.path); // TODO: extra handling for socket file?
        } else {
            self._server.listen(connCfg.port, connCfg.host);
        }
        
        self.close = self._server.close; //TODO: should this method or another close all sockets?
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
            return q.npost(sock, 'write', [str]);
        }));
    };
    
    //TODO: should we actually have a concept of different "channels"?
    pubsub.Subscriber = function(name, connCfg, pollDelay) {
        var self = this,
            log = logger.getLog();
        
        self.name = name;
        self.connCfg = connCfg;
        self.pollDelay = pollDelay || 5000; //TODO: revisit
        self.isConnected = false;
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
            
            // log.info('Client got %1: %2', typeof parsed, util.inspect(parsed));
            self.emit('message', parsed);
        })
        .on('end', function() {
            log.info('Subscriber %1 disconnected from publisher', self.name);
            self.isConnected = false;
            self.enableConnPoll(); //TODO: may want to make this behavior configurable...
        })
        .on('error', function(err) {
            log.warn('Subscriber %1 got error: %2', self.name, util.inspect(err)); //TODO: log level?
            self.isConnected = false;
            self.enableConnPoll();
        });
        //TODO: what to do on 'close' event? Is 'close' always voluntary?
        
        self.close = self._socket.end;
    };

    util.inherits(pubsub.Subscriber, events.EventEmitter);
    
    pubsub.Subscriber.prototype.enableConnPoll = function() { // TODO: rename probably
        var self = this,
            log = logger.getLog();
            
        if (self._pollInterval) {
            return; //TODO: log?
        }
        
        self._pollInterval = setInterval(function() {
            log.info('Subscriber %1 attempting reconnect to %2',
                     self.name, util.inspect(self.connCfg));
            self._socket.connect(self.connCfg);
        }, self.pollDelay);
    };
    
    /* don't think this will actually be needed...
    pubsub.Subscriber.prototype.ping = function() {
        var self = this,
            log = logger.getLog();

        log.trace('Subscriber %1 pinging server for its last message', self.name);
        self._socket.write('ping'); //TODO: can we grab + return the response here somehow?
    };
    */
    
    module.exports = pubsub;
}());
