var flush = true;
describe('journal lib: ', function() {
    var q, mockLog, mockLogger, mockHostname, mongoUtils, logger, mockColl, journal;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q = require('q');
        mockHostname = jasmine.createSpy('hostname').andReturn(q('fakeHost'));
        require.cache[require.resolve('../../lib/hostname')] = { exports: mockHostname };
        journal         = require('../../lib/journal');
        mongoUtils      = require('../../lib/mongoUtils');
        logger          = require('../../lib/logger');
        
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

        mockColl = {
            collectionName: 'mockCollection',
            isCapped: jasmine.createSpy('coll.isCapped').andCallFake(function(cb) { cb(null, true); }),
            insert: jasmine.createSpy('coll.insert').andCallFake(function(obj, opts, cb) { cb(); })
        };

        spyOn(mongoUtils, 'escapeKeys').andCallThrough();
    });
    
    describe('Journal', function() {
        describe('initialization', function() {
            it('should throw an error if no collection is provided', function() {
                expect(function() { var journ = new journal.Journal(null, 'v1', 'ut'); })
                    .toThrow('Must provide a collection!');
            });
            
            it('should initialize the journal and get the full hostname', function(done) {
                var journ = new journal.Journal(mockColl, 'v1', 'ut');
                expect(journ.svcName).toBe('ut');
                expect(journ.version).toBe('v1');
                expect(journ.name).toBe('mockCollection');
                expect(journ._coll).toBe(mockColl);
                process.nextTick(function() {
                    expect(journ.host).toBe('fakeHost');
                    expect(mockColl.isCapped).toHaveBeenCalled();
                    expect(mockHostname).toHaveBeenCalledWith(true);
                    expect(mockHostname.callCount).toBe(1);
                    done();
                });
            });
            
            it('should get the short hostname if it can\'t get the fqdn', function(done) {
                mockHostname.andCallFake(function(full) {
                    if (full) return q.reject('i got no fqdn');
                    else return q('short');
                });
                var journ = new journal.Journal(mockColl, 'v1', 'ut');
                process.nextTick(function() {
                    expect(journ.host).toBe('short');
                    expect(mockHostname).toHaveBeenCalledWith(true);
                    expect(mockHostname).toHaveBeenCalledWith();
                    expect(mockHostname.callCount).toBe(2);
                    expect(mockLog.warn).not.toHaveBeenCalled();
                    done();
                });
            });
            
            it('should log a warning if it can\'t get the hostname at all', function(done) {
                mockHostname.andReturn(q.reject('i got no hostname'));
                var journ = new journal.Journal(mockColl, 'v1', 'ut');
                process.nextTick(function() {
                    expect(journ.host).not.toBeDefined();
                    expect(mockHostname).toHaveBeenCalledWith(true);
                    expect(mockHostname).toHaveBeenCalledWith();
                    expect(mockHostname.callCount).toBe(2);
                    expect(mockLog.warn).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should log a warning if the collection is not capped', function(done) {
                mockColl.isCapped.andCallFake(function(cb) { cb(null, false); });
                var journ = new journal.Journal(mockColl, 'v1', 'ut');
                process.nextTick(function() {
                    expect(journ._coll).toBe(mockColl);
                    expect(journ.name).toBe('mockCollection');
                    expect(mockColl.isCapped).toHaveBeenCalled();
                    expect(mockLog.warn).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should log a warning if it can\'t check if the collection is capped', function(done) {
                mockColl.isCapped.andCallFake(function(cb) { cb('I GOT A PROBLEM', true); });
                var journ = new journal.Journal(mockColl, 'v1', 'ut');
                process.nextTick(function() {
                    expect(journ._coll).toBe(mockColl);
                    expect(journ.name).toBe('mockCollection');
                    expect(mockColl.isCapped).toHaveBeenCalled();
                    expect(mockLog.warn).toHaveBeenCalled();
                    done();
                });
            });
        });
        
        describe('resetColl', function() {
            var journ, newColl;
            beforeEach(function() {
                journ = new journal.Journal(mockColl, 'v1', 'ut');
                newColl = {
                    collectionName: 'newCollection',
                    isCapped: mockColl.isCapped,
                    insert: mockColl.insert
                };
            });

            it('should be able to reset the collection', function(done) {
                journ.resetColl(newColl);
                expect(journ._coll).not.toBe(mockColl);
                expect(journ._coll).toBe(newColl);
                expect(journ.name).toBe('newCollection');
                process.nextTick(function() {
                    expect(mockColl.isCapped).toHaveBeenCalled();
                    expect(mockLog.warn).not.toHaveBeenCalled();
                    done();
                });
            });
            
            it('should log a warning if the collection is not capped', function(done) {
                mockColl.isCapped.andCallFake(function(cb) { cb(null, false); });
                journ.resetColl(newColl);
                process.nextTick(function() {
                    expect(journ._coll).toBe(newColl);
                    expect(mockColl.isCapped).toHaveBeenCalled();
                    expect(mockLog.warn).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should log a warning if it can\'t check if the collection is capped', function(done) {
                mockColl.isCapped.andCallFake(function(cb) { cb('I GOT A PROBLEM', true); });
                journ.resetColl(newColl);
                process.nextTick(function() {
                    expect(journ._coll).toBe(newColl);
                    expect(mockColl.isCapped).toHaveBeenCalled();
                    expect(mockLog.warn).toHaveBeenCalled();
                    done();
                });
            });
        });
        
        describe('write', function() {
            var journ, req;
            beforeEach(function(done) {
                journ = new journal.Journal(mockColl, 'v1', 'ut');
                req = { uuid: '1234', sessionID: 's1', headers: { origin: 'c6.com' } };
                process.nextTick(done);
            });
            
            it('should write an entry to the journal', function(done) {
                journ.write('u-1', req, {foo: 'bar'}).then(function() {
                    expect(mockColl.insert).toHaveBeenCalled();
                    expect(mockColl.insert.calls[0].args[0]).toEqual({
                        user: 'u-1', created: jasmine.any(Date), host: 'fakeHost', pid: process.pid,
                        uuid: '1234', sessionID: 's1', service: 'ut', version: 'v1', origin: 'c6.com', data: {foo: 'bar'}
                    });
                    expect(mockColl.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should not set the origin header if not defined', function(done) {
                req.headers = {};
                journ.write('u-1', req, {foo: 'bar'}).then(function() {
                    expect(mockColl.insert.calls[0].args[0].origin).toBe(undefined);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should prevent spoofing the origin with an object', function(done) {
                req.headers.origin = { $set: { key: 'malicious' } };
                journ.write('u-1', req, {foo: 'bar'}).then(function() {
                    expect(mockColl.insert.calls[0].args[0].origin).toBe('[object Object]');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should use the referer header if the origin is not defined', function(done) {
                req.headers = { referer: 'not.c6.com' };
                journ.write('u-1', req, {foo: 'bar'}).then(function() {
                    expect(mockColl.insert.calls[0].args[0].origin).toBe('not.c6.com');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should prefer the origin header if both are defined', function(done) {
                req.headers = { referer: 'not.c6.com', origin: 'c6.com' };
                journ.write('u-1', req, {foo: 'bar'}).then(function() {
                    expect(mockColl.insert.calls[0].args[0].origin).toBe('c6.com');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject if it fails to write to the journal', function(done) {
                mockColl.insert.andCallFake(function(obj, opts, cb) { cb('I GOT A PROBLEM'); });
                journ.write('u-1', req, {foo: 'bar'}).then(function() {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('I GOT A PROBLEM');
                    expect(mockColl.insert).toHaveBeenCalled();
                    expect(mockLog.warn).toHaveBeenCalled();
                }).done(done);
            });
        });
    });
    
    describe('AuditJournal', function() {
        describe('initialization', function() {
            it('should call the Journal constructor', function(done) {
                spyOn(journal.Journal, 'apply').andCallThrough();
                journ = new journal.AuditJournal(mockColl, 'v1', 'ut');
                expect(journal.Journal.apply).toHaveBeenCalledWith(journ, {0: mockColl, 1: 'v1', 2: 'ut'});
                expect(journ.svcName).toBe('ut');
                expect(journ.version).toBe('v1');
                expect(journ.name).toBe('mockCollection');
                expect(journ._coll).toBe(mockColl);
                process.nextTick(function() {
                    expect(journ.host).toBe('fakeHost');
                    expect(mockColl.isCapped).toHaveBeenCalled();
                    expect(mockHostname).toHaveBeenCalledWith(true);
                    expect(mockHostname.callCount).toBe(1);
                    done();
                });
            });
        });
        
        describe('inherited methods', function() {
            it('should exist', function() {
                journ = new journal.AuditJournal(mockColl, 'v1', 'ut');
                expect(journ.resetColl).toBe(journal.Journal.prototype.resetColl);
                expect(journ.write).toBe(journal.Journal.prototype.write);
                expect(journ instanceof journal.Journal).toBe(true);
            });
        });
        
        describe('writeAuditEntry', function() {
            var journ, req;
            beforeEach(function() {
                journ = new journal.AuditJournal(mockColl, 'v1', 'ut');
                req = {
                    params: [],
                    query: { foo: 'bar' },
                    method: 'get',
                    route: { path: '/jiggy/with/it' }
                };
                req.params.id = 'e-1';
                spyOn(journ, 'write').andReturn(q());
            });

            it('should call write with the proper data', function(done) {
                journ.writeAuditEntry(req, 'u-1').then(function() {
                    expect(journ.write).toHaveBeenCalledWith('u-1', req,
                        {route: 'GET /jiggy/with/it', params: {id: 'e-1'}, query: {foo: 'bar'}});
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should reject if write rejects', function(done) {
                journ.write.andReturn(q.reject('I GOT A PROBLEM'));
                journ.writeAuditEntry(req, 'u-1').then(function() {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('I GOT A PROBLEM');
                    expect(journ.write).toHaveBeenCalled();
                }).done(done);
            });
        });
        
        describe('middleware', function() {
            var journ, req, res;
            beforeEach(function() {
                journ = new journal.AuditJournal(mockColl, 'v1', 'ut');
                req = {
                    uuid: '1234',
                    user: { id: 'u-1', email: 'johnny' }
                };
                res = {
                    send: jasmine.createSpy('res.send')
                };
                spyOn(journ, 'writeAuditEntry').andReturn(q());
            });

            it('should call writeAuditEntry and then call next', function(done) {
                journ.middleware(req, res, function(val) {
                    expect(val).not.toBeDefined();
                    expect(journ.writeAuditEntry).toHaveBeenCalledWith(req, 'u-1');
                    done();
                });
                expect(res.send).not.toHaveBeenCalled();
            });
            
            it('should skip writing if no user is logged in', function(done) {
                delete req.user;
                journ.middleware(req, res, function(val) {
                    expect(val).not.toBeDefined();
                    expect(journ.writeAuditEntry).not.toHaveBeenCalled();
                    done();
                });
                expect(res.send).not.toHaveBeenCalled();
            });
            
            it('should not send a 500 if writeAuditEntry fails', function(done) {
                journ.writeAuditEntry.andReturn(q.reject('I GOT A PROBLEM'));
                journ.middleware(req, res, function(val) {
                    expect(val).not.toBeDefined();
                    expect(journ.writeAuditEntry).toHaveBeenCalledWith(req, 'u-1');
                    done();
                });
                expect(res.send).not.toHaveBeenCalled();
            });
        });
    });
});

