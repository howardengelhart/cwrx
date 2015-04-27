/*jslint camelcase: false */
(function(){
    'use strict';
    var q           = require('q'),
        net         = require('net'),
        util        = require('util'),
        logger      = require('./logger'),
        
        ipc = {}; //TODO: probably rename this module...

    //TODO: everything here is TODO
    ipc.createServer = function(path) { //TODO: this should really be async and resolve once listen event fires...
        var log = logger.getLog(),
            server = net.createServer();
        
        server._sockets = [];
        server._clientCount = 0; // used for giving clients helpful ids
        server._lastMsg = '';
        
        server.on('connection', function(c) {
            c._id = ++server._clientCount;
            log.info('Server got new client #%1', c._id);
            server._sockets.push(c);
            
            log.trace('Sending client #%1 last message: %2', c._id, server._lastMsg);
            c.write(server._lastMsg);
            
            c.on('data', function(/*data*/) {
                // TODO: may want to eventually do different things based on received data
                log.trace('Got ping from client #%1, sending %2', c._id, server._lastMsg);
                c.write(server._lastMsg);
            })
            .on('end', function() {
                log.info('Server conn to client #%1 disconnected', c._id);
                server._sockets = server._sockets.filter(function(sock) {
                    return sock._id !== c._id;
                });
            })
            .on('error', function(err) {
                log.info('Server conn to client #%1 got error: %2', c._id, util.inspect(err));
            });
        });

        server.broadcast = function(data) {
            var self = this,
                str = JSON.stringify(data);
                
            self._lastMsg = str;
            
            if (self._sockets.length === 0) {
                log.info('No clients to write to :(');
                return q();
            }
            
            log.trace('Server broadcasting %1', str);
            
            return q.all(server._sockets.map(function(sock) {
                return q.npost(sock, 'write', [str]);
            }));
        };
        
        server.listen(path);
        
        return server;
    };
    
    ipc.createClient = function(path) { //TODO: this should really be async and resolve once connect event fires...
        var log = logger.getLog(),
            client = net.connect({path: path});
            
        client.on('connect', function() {
            log.info('Client is connected');
        })
        .on('data', function(data) {
            var str = data.toString(),
                parsed;
            
            try {
                parsed = JSON.parse(str);
            } catch(e) {
                parsed = str;
            }
            
            log.info('Client got %1: %2', typeof parsed, util.inspect(parsed));
        })
        .on('end', function() {
            log.info('Client disconnected');
        })
        .on('error', function(err) {
            log.info('Client got error: %1', util.inspect(err));
        });
        
        client.ping = function() {
            log.trace('Client pinging server for its last message');
            client.write('ping'); //TODO: can we grab + return the response here somehow?
        };
        
        return client;
    };

    module.exports = ipc;
}());
