var flush = true;
describe('search (UT)', function() {
    var search, mockLog, mockLogger, req, q, logger, requestUtils, anyFunc;
        
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        requestUtils    = require('../../lib/requestUtils');
        search          = require('../../bin/search');
        
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
        req = {
            uuid: '12345',
            user: { id: 'u1' }
        };
        anyFunc = jasmine.any(Function);
    });
    
    describe('parseDuration', function() {
        it('should return undefined if no duration string is passed in', function() {
            expect(search.parseDuration(null, 'yt.com/asdf')).toBe(undefined);
            expect(mockLog.warn).toHaveBeenCalled();
        });
        
        it('should properly parse strings of the format "PT#H#M#S"', function() {
            expect(search.parseDuration('PT1H1M1S')).toBe(3661);
            expect(search.parseDuration('PT13H34M23S')).toBe(48863);
            expect(search.parseDuration('PT03M0012S')).toBe(192);
            expect(search.parseDuration('PT349S')).toBe(349);
            expect(mockLog.warn).not.toHaveBeenCalled();
        });
        
        it('should properly parse strings of the format "# mins"', function() {
            expect(search.parseDuration('12 mins')).toBe(720);
            expect(search.parseDuration('02 mins')).toBe(120);
            expect(mockLog.warn).not.toHaveBeenCalled();
        });
        
        it('should return undefined if the duration is in an unknown format', function() {
            expect(search.parseDuration('qoiwuradf')).toBe(undefined);
            expect(search.parseDuration('P1H1M1S')).toBe(undefined);
            expect(search.parseDuration('PT1HM1S')).toBe(undefined);
            expect(search.parseDuration('some mins')).toBe(undefined);
            expect(mockLog.warn.callCount).toBe(4);
        });
    });
    
    describe('formatGoogleResults', function() {
        var stats, items;
        beforeEach(function() {
            stats = { startIndex: 11, count: 20, totalResults: 12345 };
            items = [
                { title: 'YT Test', link: 'http://www.youtube.com/watch?v=GdEKSyad_rk', displayLink: 'www.youtube.com',
                  pagemap: { videoobject: [{description: 'YT desc', duration: 'PT1M13S', height: 1080}],
                             cse_thumbnail: [{width: 300, height: 168, src: 'http://img.com'}] } },
                { title: 'V Test', link: 'http://vimeo.com/77428778', displayLink: 'vimeo.com',
                  pagemap: { videoobject: [{description: 'V desc', duration: '2 mins', height: 720, thumbnailurl: 'http://thumb.com'}],
                             cse_thumbnail: [{width: 100, height: 100, src: 'http://img2.com'}] } },
                { title: 'DM Test', link: 'http://www.dailymotion.com/video/x169luh_waterski-breakdancing-2013_sport', displayLink: 'www.dailymotion.com',
                  pagemap: { videoobject: [{description: 'DM desc', duration: 'PT0H1M12S', height: 564, thumbnailurl: 'http://img3.com'}] } }
            ];
            spyOn(search, 'parseDuration').andCallThrough();
        });
        
        it('should correctly format the results', function() {
            expect(search.formatGoogleResults(stats, items)).toEqual({
                meta: {skipped: 10, numResults: 20, totalResults: 12345},
                items: [
                    { title: 'YT Test', link: 'http://www.youtube.com/watch?v=GdEKSyad_rk', siteLink: 'www.youtube.com',
                      description: 'YT desc', site: 'youtube', hd: true, duration: 73, videoid: 'GdEKSyad_rk',
                      thumbnail: { width: 300, height: 168, src: 'http://img.com' } },
                    { title: 'V Test', link: 'http://vimeo.com/77428778', siteLink: 'vimeo.com',
                      description: 'V desc', site: 'vimeo', hd: true, duration: 120, videoid: '77428778',
                      thumbnail: { width: 100, height: 100, src: 'http://img2.com' } },
                    { title: 'DM Test', link: 'http://www.dailymotion.com/video/x169luh_waterski-breakdancing-2013_sport', siteLink: 'www.dailymotion.com',
                      description: 'DM desc', site: 'dailymotion', hd: false, duration: 72, videoid: 'x169luh',
                      thumbnail: { src: 'http://img3.com' } }
                ]
            });
            expect(mockLog.warn).not.toHaveBeenCalled();
        });
        
        it('should filter out invalid items received from google', function() {
            stats.count = 6;
            items.push(
                { title: 'Fake 1', displayLink: 'vimeo.com',
                  pagemap: { videoobject: [{description: 'Fake desc', duration: 'PT0H1M12S', height: 564}] } },
                { title: 'Fake 2', displayLink: 'vimeo.com',
                  pagemap: { videoobject: {description: 'Fake desc', duration: 'PT0H1M12S', height: 564} } },
                { title: 'Fake 3', displayLink: 'vimeo.com' }
            );
            var results = search.formatGoogleResults(stats, items);
            expect(results.meta).toEqual({skipped: 10, numResults: 6, totalResults: 12345});
            expect(results.items.length).toBe(3);
            expect(results.items[0].title).toBe('YT Test');
            expect(results.items[1].title).toBe('V Test');
            expect(results.items[2].title).toBe('DM Test');
            expect(mockLog.warn.callCount).toBe(3);
        });
    });
    
    describe('findVideosWithGoogle', function() {
        var opts, googleCfg, apiKey;
        beforeEach(function() {
            spyOn(requestUtils, 'qRequest').andReturn(q({
                response: { statusCode: 200 },
                body: { queries: { request: [{stats: 'yes'}] }, items: 'fakeItems' }
            }));
            opts = { query: 'foo', limit: 10, start: 20 };
            googleCfg = {apiUrl: 'http://google.com/cse', engineId: 'asdf1234', fields: 'fakeFields'};
            apiKey = 'zxcv5678';
            spyOn(search, 'formatGoogleResults').andReturn('formatted');
        });

        it('should query google for videos', function(done) {
            search.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get', {url: 'http://google.com/cse',
                    qs: {q: 'foo', cx: 'asdf1234', key: 'zxcv5678', num: 10, start: 20, fields: 'fakeFields'},
                    headers: {Referer: 'https://portal.cinema6.com/index.html'}});
                expect(search.formatGoogleResults).toHaveBeenCalledWith({stats: 'yes'}, 'fakeItems');
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to restrict results to certain sites', function(done) {
            opts.sites = ['youtube.com', 'vimeo.com'];
            search.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                var reqOpts = requestUtils.qRequest.calls[0].args[1];
                expect(reqOpts.qs.q).toBe('foo site:youtube.com OR site:vimeo.com');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to restrict results to only hd videos', function(done) {
            opts.hd = 'true';
            search.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                var reqOpts = requestUtils.qRequest.calls[0].args[1];
                expect(reqOpts.qs.sort).toBe('videoobject-height:r:720');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });

        it('should be able to restrict results to non hd videos', function(done) {
            opts.hd = 'false';
            search.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                var reqOpts = requestUtils.qRequest.calls[0].args[1];
                expect(reqOpts.qs.sort).toBe('videoobject-height:r::719');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to retry failed requests to google', function(done) {
            requestUtils.qRequest.andCallFake(function(method, opts) {
                if (this.qRequest.callCount >= 2) {
                    return q({
                        response: { statusCode: 200 },
                        body: { queries: { request: [{stats: 'yes'}] }, items: 'fakeItems' }
                    });
                } else {
                    return q.reject({error: 'I GOT A PROBLEM'});
                }
            });
            search.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockLog.warn.callCount).toBe(1);
                expect(requestUtils.qRequest.callCount).toBe(2);
                expect(search.formatGoogleResults).toHaveBeenCalledWith({stats: 'yes'}, 'fakeItems');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 500 code if google returns a non-2xx status code', function(done) {
            q.all([100, 300, 400, 500].map(function(code) {
                requestUtils.qRequest.andReturn(q({response: {statusCode: code}, body: 'fake'}));
                return search.findVideosWithGoogle(req, opts, googleCfg, apiKey);
            })).then(function(results) {
                results.forEach(function(result) {
                    expect(result).toEqual({code: 500, body: 'Error querying google'});
                });
                expect(mockLog.warn.callCount).toBe(8);
                expect(requestUtils.qRequest.callCount).toBe(8);
                expect(search.formatGoogleResults).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 500 code if google returns an incomplete body', function(done) {
            q.all([{items: 'fake'}, {queries: 'fake', items: 'fake'}, {queries: {request: 'fake'}}]
            .map(function(body) {
                requestUtils.qRequest.andReturn(q({response: {statusCode: 200}, body: body}));
                return search.findVideosWithGoogle(req, opts, googleCfg, apiKey);
            })).then(function(results) {
                results.forEach(function(result) {
                    expect(result).toEqual({code: 500, body: 'Error querying google'});
                });
                expect(mockLog.warn.callCount).toBe(6);
                expect(requestUtils.qRequest.callCount).toBe(6);
                expect(search.formatGoogleResults).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 500 code if the request fails', function(done) {
            requestUtils.qRequest.andReturn(q.reject({error: 'I GOT A PROBLEM'}));
            search.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 500, body: 'Error querying google'});
                expect(mockLog.warn.callCount).toBe(2);
                expect(requestUtils.qRequest.callCount).toBe(2);
                expect(search.formatGoogleResults).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
    });
    
    describe('findVideos', function() {
        var config, secrets;
        beforeEach(function() {
            req.query = {query: 'foo', limit: '10', skip: '20', sites: 'youtube,vimeo', hd: 'true'};
            config = { google: 'fakeGoogleCfg', foo: 'bar' };
            secrets = { googleKey: 'asdf1234', other: 'yes' };
            spyOn(search, 'findVideosWithGoogle').andReturn(q('fakeResp'));
        });

        it('should call findVideosWithGoogle', function(done) {
            search.findVideos(req, config, secrets).then(function(resp) {
                expect(resp).toBe('fakeResp');
                expect(search.findVideosWithGoogle).toHaveBeenCalledWith(req,
                    {query: 'foo', limit: 10, start: 21, sites: ['youtube.com', 'vimeo.com'], hd: 'true'},
                    'fakeGoogleCfg', 'asdf1234');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should use defaults for some opts if not provided', function(done) {
            req.query = {query: 'foo'};
            search.findVideos(req, config, secrets).then(function(resp) {
                expect(resp).toBe('fakeResp');
                expect(search.findVideosWithGoogle).toHaveBeenCalledWith(req,
                    {query: 'foo', limit: 10, start: 1, sites: null, hd: undefined},
                    'fakeGoogleCfg', 'asdf1234');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should guard against invalid values for the limit and skip params', function(done) {
            q.all([['a1', 'a1'], ['-1', '-2'], ['11', '0']].map(function(params) {
                req.query.limit = params[0];
                req.query.skip = params[1];
                return search.findVideos(req, config, secrets);
            })).then(function(results) {
                results.forEach(function(result, idx) {
                    expect(result).toBe('fakeResp');
                    if (idx === 1) expect(search.findVideosWithGoogle.calls[idx].args[1].limit).toBe(1);
                    else expect(search.findVideosWithGoogle.calls[idx].args[1].limit).toBe(10);
                    expect(search.findVideosWithGoogle.calls[idx].args[1].start).toBe(1);
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 400 if there\'s no query string in the request', function(done) {
            delete req.query.query;
            search.findVideos(req, config, secrets).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'No query in request'});
                expect(search.findVideosWithGoogle).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should reject if findVideosWithGoogle fails', function(done) {
            search.findVideosWithGoogle.andReturn(q.reject('I GOT A PROBLEM'));
            search.findVideos(req, config, secrets).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(search.findVideosWithGoogle).toHaveBeenCalled();
            }).finally(done);
        });
    });
});
