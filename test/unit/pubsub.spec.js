var util = require('util'),
    events = require('events'),
    flush = true;
describe('pubsub', function() {
    var q, mockLog, logger, pubsub, net, anyFunc, mockServer, portNum;
    
    function MockSocket() {
        var self = this;
        portNum++;
        
        self.localAddress = '127.0.0.1';
        self.remoteAddress = '127.0.0.1';
        self.localPort = portNum;
        self.remotePort = portNum * 100;
        
        self.connect = jasmine.createSpy('socket.connect()');
        self.end = jasmine.createSpy('socket.end()').andCallFake(function() {
            self.emit('end');
        });
        self.write = jasmine.createSpy('socket.write()').andCallFake(function(data, cb) {
            if (typeof cb === 'function') cb();
        });
        self.resume = jasmine.createSpy('socket.resume()');
        self.address = jasmine.createSpy('socket.address()').andReturn({ port: self.localPort,
                                                                         address: self.localAddress });
    }
    util.inherits(MockSocket, events.EventEmitter);
    
    beforeEach(function() {
        jasmine.Clock.useMock();
        // clearTimeout/clearInterval not properly mocked in jasmine-node: https://github.com/mhevery/jasmine-node/issues/276
        spyOn(global, 'clearTimeout').andCallFake(function() {
            return jasmine.Clock.installed.clearTimeout.apply(this, arguments);
        });
        spyOn(global, 'clearInterval').andCallFake(function() {
            return jasmine.Clock.installed.clearInterval.apply(this, arguments);
        });

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        net         = require('net');
        logger      = require('../../lib/logger');
        pubsub      = require('../../lib/pubsub');
        anyFunc     = jasmine.any(Function);
        
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
        
        portNum = 0;
        
        mockServer = new events.EventEmitter();
        mockServer.close = jasmine.createSpy('server.close()');
        mockServer.listen = jasmine.createSpy('server.listen()');
        spyOn(net, 'createServer').andReturn(mockServer);

        spyOn(net, 'connect').andCallFake(function() {
            return new MockSocket();
        });
    });
    
    describe('Publisher', function() {
        var pub, sock1, sock2;
        beforeEach(function() {
            pub = new pubsub.Publisher('test', { port: 123 });
            sock1 = new MockSocket();
            sock2 = new MockSocket();
        });

        describe('initialization', function() {
            it('should successfully initialize the server', function() {
                var p = new pubsub.Publisher('test', { port: 456, host: 'h1' });
                expect(p.name).toBe('test');
                expect(p._sockets).toEqual([]);
                expect(p.lastMsg).toBe('');
                expect(p._server).toBe(mockServer);
                expect(net.createServer).toHaveBeenCalled();
                expect(mockServer.listen).toHaveBeenCalledWith(456, 'h1', anyFunc);
            });

            it('should throw an error if not provided with a complete connection config', function() {
                var msg = 'Must provide a cfg object with port or socket path';
                expect(function() { var p = new pubsub.Publisher('test'); }).toThrow(msg);
                expect(function() { var p = new pubsub.Publisher('test', {}); }).toThrow(msg);
                expect(function() { var p = new pubsub.Publisher('test', { host: 'h1' }); }).toThrow(msg);
                expect(function() { var p = new pubsub.Publisher('test', { port: 123 }); }).not.toThrow();
                expect(function() { var p = new pubsub.Publisher('test', { path: '/tmp/test' }); }).not.toThrow();
            });
            
            it('should be able to listen on a unix socket', function() {
                var p = new pubsub.Publisher('test', { path: '/tmp/test' });
                expect(p._server).toBe(mockServer);
                expect(mockServer.listen).toHaveBeenCalledWith('/tmp/test', anyFunc);
            });
        });
        
        describe('on receiving a client connection', function() {
            it('should save the socket internally and send it the last message', function() {
                pub._server.emit('connection', sock1);
                expect(pub._sockets).toEqual([sock1]);
                expect(sock1._clientAddr).toBe('127.0.0.1:100');
                expect(sock1.write).toHaveBeenCalledWith('');
                expect(sock1.resume).toHaveBeenCalledWith();
                
                pub.lastMsg = 'foo';
                mockServer.emit('connection', sock2);
                expect(pub._sockets).toEqual([sock1, sock2]);
                expect(sock2._clientAddr).toBe('127.0.0.1:200');
                expect(sock2.write).toHaveBeenCalledWith('foo');
                expect(sock2.resume).toHaveBeenCalledWith();
                expect(sock1.write.calls.length).toBe(1);
            });
        });
        
        describe('on a client disconnecting', function() {
            it('should remove the socket from its internal array', function() {
                pub._server.emit('connection', sock1); pub._server.emit('connection', sock2);
                expect(pub._sockets).toEqual([sock1, sock2]);

                sock1.emit('end');
                expect(pub._sockets).toEqual([sock2]);
                expect(mockLog.warn).toHaveBeenCalled();
            });
        });
        
        describe('on a client connection getting an error', function() {
            it('should log a warning and remove the socket from its internal array', function() {
                pub._server.emit('connection', sock1); pub._server.emit('connection', sock2);
                expect(pub._sockets).toEqual([sock1, sock2]);

                sock2.emit('error');
                expect(pub._sockets).toEqual([sock1]);
                expect(sock2.end).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            });
        });
        
        describe('close', function() {
            it('should close the server and all client connections', function() {
                pub._server.emit('connection', sock1); pub._server.emit('connection', sock2);
                expect(pub._sockets).toEqual([sock1, sock2]);
                
                pub.close();
                expect(pub._server.close).toHaveBeenCalled();
                expect(pub._sockets).toEqual([]);
                expect(sock1.end).toHaveBeenCalled();
                expect(sock2.end).toHaveBeenCalled();
            });
            
            it('should just close the server if there are no client connections', function() {
                pub.close();
                expect(pub._server.close).toHaveBeenCalled();
                expect(pub._sockets).toEqual([]);
                expect(sock1.end).not.toHaveBeenCalled();
                expect(sock2.end).not.toHaveBeenCalled();
            });
        });
        
        describe('broadcast', function() {
            it('should write a message to all clients', function(done) {
                pub._server.emit('connection', sock1); pub._server.emit('connection', sock2);
                
                pub.broadcast({foo: 'bar'}).then(function(results) {
                    expect(pub.lastMsg).toEqual(JSON.stringify({foo: 'bar'}));
                    expect(sock1.write).toHaveBeenCalledWith(JSON.stringify({foo: 'bar'}), anyFunc);
                    expect(sock2.write).toHaveBeenCalledWith(JSON.stringify({foo: 'bar'}), anyFunc);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should just set the lastMsg if no clients are connected', function(done) {
                pub.broadcast({foo: 'bar'}).then(function(results) {
                    expect(pub.lastMsg).toEqual(JSON.stringify({foo: 'bar'}));
                    expect(sock1.write).not.toHaveBeenCalled();
                    expect(sock2.write).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject if one of the writes fails', function(done) {
                sock2.write.andCallFake(function(data, cb) {
                    if (typeof cb === 'function') cb('I GOT A PROBLEM');
                });
                pub._server.emit('connection', sock1); pub._server.emit('connection', sock2);

                pub.broadcast({foo: 'bar'}).then(function(results) {
                    expect(results).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toBe('Socket error');
                    expect(pub.lastMsg).toEqual(JSON.stringify({foo: 'bar'}));
                    expect(sock1.write).toHaveBeenCalledWith(JSON.stringify({foo: 'bar'}), anyFunc);
                    expect(sock2.write).toHaveBeenCalledWith(JSON.stringify({foo: 'bar'}), anyFunc);
                    expect(mockLog.warn).toHaveBeenCalled();
                }).done(done);
            });
        });
    });

    describe('Subscriber', function() {
        describe('initialization', function() {
            it('should initalize the underlying socket and other properties', function() {
                var opts = { reconnect: false, reconnectDelay: 2000, pingDelay: 1000 },
                    sub = new pubsub.Subscriber('test', {port: 123}, opts);

                expect(sub instanceof events.EventEmitter).toBe(true);
                expect(sub.name).toBe('test');
                expect(sub.connCfg).toEqual({port: 123});
                expect(sub.reconnect).toEqual({ enabled: false, delay: 2000 });
                expect(sub.ping).toEqual({ delay: 1000 });
                expect(sub.lastMsg).toBe(null);
                expect(sub.localAddr).toBe('');
                expect(sub._socket instanceof MockSocket).toBe(true);
                expect(net.connect).toHaveBeenCalledWith({port: 123});
            });
            
            it('should have default opts', function() {
                var sub = new pubsub.Subscriber('test', {port: 123});
                expect(sub.reconnect).toEqual({ enabled: true, delay: 5000 });
                expect(sub.ping).toEqual({ delay: 5000 });
            });
            
            it('should throw an error if not provided with a complete connection config', function() {
                var msg = 'Must provide a cfg object with port or socket path';
                expect(function() { var s = new pubsub.Subscriber('test'); }).toThrow(msg);
                expect(function() { var s = new pubsub.Subscriber('test', {}); }).toThrow(msg);
                expect(function() { var s = new pubsub.Subscriber('test', { host: 'h1' }); }).toThrow(msg);
                expect(function() { var s = new pubsub.Subscriber('test', { port: 123 }); }).not.toThrow();
                expect(function() { var s = new pubsub.Subscriber('test', { path: '/tmp/test' }); }).not.toThrow();
            });
        });
        
        describe('on connecting', function() {
            it('should setup an interval for periodically pinging the server', function() {
                var sub = new pubsub.Subscriber('test', {port: 123});
                sub._socket.emit('connect');
                expect(sub.localAddr).toBe('127.0.0.1:1');
                expect(sub.ping._interval).toBeDefined();
                jasmine.Clock.tick(5001);
                expect(sub._socket.write).toHaveBeenCalledWith('ping');
                jasmine.Clock.tick(5001);
                jasmine.Clock.tick(5001);
                expect(sub._socket.write.calls.length).toBe(3);
            });
            
            it('should clear the reconnect interval', function() {
                var sub = new pubsub.Subscriber('test', {port: 123});
                sub.beginReconnect();
                expect(sub.reconnect._interval).toBeDefined();
                jasmine.Clock.tick(5001);
                expect(sub._socket.connect.calls.length).toBe(1);
                
                sub._socket.emit('connect');
                expect(sub.reconnect._interval).not.toBeDefined();
                jasmine.Clock.tick(5001);
                jasmine.Clock.tick(5001);
                expect(sub._socket.connect.calls.length).toBe(1);
            });
        });
        
        describe('on receiving data', function() {
            it('should try to parse the data and emit a message event', function(done) {
                var sub = new pubsub.Subscriber('test', {port: 123});
                sub.on('message', function(msg) {
                    expect(msg).toEqual({ sup: 'dawg' });
                    expect(sub.lastMsg).toEqual({ sup: 'dawg' });
                    done();
                });
                sub._socket.emit('data', new Buffer(JSON.stringify({ sup: 'dawg' })));
            });
            
            it('should still emit a message if it can\'t be parsed', function(done) {
                var sub = new pubsub.Subscriber('test', {port: 123});
                sub.on('message', function(msg) {
                    expect(msg).toEqual('sup dawg');
                    expect(sub.lastMsg).toEqual('sup dawg');
                    done();
                });
                sub._socket.emit('data', new Buffer('sup dawg'));
            });
        });
        
        describe('on disconnecting', function() {
            it('should call beginReconnect', function() {
                var sub = new pubsub.Subscriber('test', {port: 123});
                spyOn(sub, 'beginReconnect');
                sub._socket.emit('connect');
                sub._socket.emit('end');
                expect(sub.beginReconnect).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            });
        });

        describe('on receiving an error', function() {
            it('should call beginReconnect', function() {
                var sub = new pubsub.Subscriber('test', {port: 123});
                spyOn(sub, 'beginReconnect');
                sub._socket.emit('connect');
                sub._socket.emit('error', 'I GOT A PROBLEM');
                expect(sub.beginReconnect).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            });
        });
        
        describe('beginReconnect', function() {
            it('should set an interval to call socket.connect', function() {
                var sub = new pubsub.Subscriber('test', {port: 123}, { reconnectDelay: 2000 });
                sub.beginReconnect();
                expect(sub.reconnect._interval).toBeDefined();
                jasmine.Clock.tick(2001);
                expect(sub._socket.connect).toHaveBeenCalledWith({port: 123});
                expect(sub._socket.connect.calls.length).toBe(1);
                jasmine.Clock.tick(2001);
                jasmine.Clock.tick(2001);
                expect(sub._socket.connect.calls.length).toBe(3);
            });
            
            it('should clear the ping interval', function() {
                var sub = new pubsub.Subscriber('test', {port: 123});
                sub._socket.emit('connect');
                expect(sub.ping._interval).toBeDefined();
                jasmine.Clock.tick(5001);
                expect(sub._socket.write.calls.length).toBe(1);
                
                sub.beginReconnect();
                expect(sub.ping._interval).not.toBeDefined();
                jasmine.Clock.tick(5001);
                jasmine.Clock.tick(5001);
                expect(sub._socket.write.calls.length).toBe(1);
            });
            
            it('should do nothing if the interval has already been created', function() {
                var sub = new pubsub.Subscriber('test', {port: 123}, { reconnectDelay: 2000 });
                sub.beginReconnect();
                sub.beginReconnect();
                expect(sub.reconnect._interval).toBeDefined();
                jasmine.Clock.tick(2001);
                expect(sub._socket.connect.calls.length).toBe(1);
            });
            
            it('should do nothing if reconnecting is disabled', function() {
                var sub = new pubsub.Subscriber('test', {port: 123}, { reconnect: false });
                sub.beginReconnect();
                expect(sub.reconnect._interval).not.toBeDefined();
                jasmine.Clock.tick(2001);
                expect(sub._socket.connect).not.toHaveBeenCalled();
            });
        });
        
        describe('close', function() {
            it('should close the socket and not reconnect', function() {
                var sub = new pubsub.Subscriber('test', {port: 123}, { reconnect: true, reconnectDelay: 2000 });
                sub.close();
                expect(sub.reconnect._interval).not.toBeDefined();
                expect(sub.reconnect.enabled).toBe(false);
                jasmine.Clock.tick(2001);
                expect(sub._socket.connect).not.toHaveBeenCalled();
            });
        });
        
        // integration test for connection polling/reconnect system
        describe('when the connection is lost', function() {
            it('should periodically try to reconnect, and stop once it succeeds', function() {
                // initial setup and connect
                var sub = new pubsub.Subscriber('test', {port: 123}, { reconnectDelay: 2000 });
                sub._socket.emit('connect');
                
                // subscriber disconnects
                sub._socket.emit('end');
                expect(sub.reconnect._interval).toBeDefined();

                // reconnect attempts, but no success yet
                jasmine.Clock.tick(2001);
                jasmine.Clock.tick(2001);
                jasmine.Clock.tick(2001);
                expect(sub._socket.connect.calls.length).toBe(3);
                
                // reconnect
                sub._socket.emit('connect');
                expect(sub.reconnect._interval).not.toBeDefined();

                // should not be calling socket.connect anymore
                jasmine.Clock.tick(2001);
                expect(sub._socket.connect.calls.length).toBe(3);
            });
        });
    });
});

