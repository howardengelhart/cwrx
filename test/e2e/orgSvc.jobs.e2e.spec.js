var q               = require('q'),
    util            = require('util'),
    cacheLib        = require('../../lib/cacheLib'),
    requestUtils    = require('../../lib/requestUtils'),
    cacheServer     = process.env.cacheServer || 'localhost:11211',
    host            = process.env.host || 'localhost',
    orgSvcUrl       = 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api/account/org';

describe('/api/account/org/job/:reqId', function() {
    var mockData, cacheConn;
    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 5000;

        mockData = {
            'a1234': { code: 200, body: [{ foo: 'bar' }, {foo: 'baz'}] },
            'b4567': { code: 202, body: { url: '/api/account/org/job/b4567' } },
            'c7890': { code: 500, body: { error: 'Internal error', detail: 'I GOT A PROBLEM' } }
        };
        cacheConn = new cacheLib.Cache(cacheServer, { read: 5000, write: 5000 });
        cacheConn.checkConnection().then(function() {
            return q.all(Object.keys(mockData).map(function(key) {
                return cacheConn.set('req:' + key, mockData[key], 10*1000);
            }));
        }).thenResolve().done(done);
    });
    
    afterEach(function(done) {
        return q.all(Object.keys(mockData).map(function(key) {
            return cacheConn.delete('req:' + key);
        })).then(function() {
            cacheConn.close();
        }).done(done);
    });
    
    it('should retrieve a status code and body from memcached', function(done) {
        q.allSettled([
            requestUtils.qRequest('get', { url: orgSvcUrl + '/job/a1234' }, null, {enabled: false}),
            requestUtils.qRequest('get', { url: orgSvcUrl + '/job/b4567' }, null, {enabled: false}),
            requestUtils.qRequest('get', { url: orgSvcUrl + '/job/c7890' }, null, {enabled: false})
        ]).then(function(results) {
            expect(results[0].state).toBe('fulfilled');
            expect(results[0].value.response.statusCode).toBe(200);
            expect(results[0].value.body).toEqual([{ foo: 'bar' }, {foo: 'baz'}]);
            expect(results[1].state).toBe('fulfilled');
            expect(results[1].value.response.statusCode).toBe(202);
            expect(results[1].value.body).toEqual({ url: '/api/account/org/job/b4567' });
            expect(results[2].state).toBe('rejected');
            expect(results[2].reason.body).toEqual({ error: 'Internal error', detail: 'I GOT A PROBLEM' });
        }).catch(function(error) {
            expect(util.inspect(error)).not.toBeDefined();
        }).done(done);
    });
    
    it('should return a 404 if the result is not found', function(done) {
        requestUtils.qRequest('get', { url: orgSvcUrl + '/job/fake3819' }, null, {enabled: false})
        .then(function(resp) {
            expect(resp.response.statusCode).toBe(404);
            expect(resp.body).toBe('No result with that id found');
        }).catch(function(error) {
            expect(util.inspect(error)).not.toBeDefined();
        }).done(done);
    });
});
