describe('ADTECHBannerClient(config)', function() {
    var ADTECHBannerClient;
    var request;
    var BluebirdPromise;
    var Promise;
    var extend;
    var q;

    var now;
    var requestDeferreds;
    var localRequest;

    beforeEach(function() {
        request = require('request-promise');
        BluebirdPromise = require('bluebird');
        Promise = require('q').defer().promise.constructor;
        extend = require('../../lib/objUtils').extend;
        q = require('q');

        now = Date.now();
        jasmine.clock().install();
        jasmine.clock().mockDate();

        requestDeferreds = {};
        var defaults = request.defaults;
        spyOn(request, 'defaults').and.callFake(function() {
            localRequest = defaults.apply(request, arguments);
            spyOn(localRequest, 'get').and.callFake(function(url) {
                var deferred = {};
                var req = new BluebirdPromise(function(resolve, reject) {
                    deferred.resolve = resolve;
                    deferred.reject = reject;
                });

                requestDeferreds[url] = deferred;
                deferred.request = req;

                return req;
            });

            return localRequest;
        });

        ADTECHBannerClient = require('../../lib/adtechBannerClient');
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });

    it('should exist', function() {
        expect(ADTECHBannerClient).toEqual(jasmine.any(Function));
        expect(ADTECHBannerClient.name).toBe('ADTECHBannerClient');
    });

    describe('static:', function() {
        describe('@private', function() {
            describe('methods:', function() {
                describe('__parseBanner__(string)', function() {
                    var string;
                    var result;

                    beforeEach(function() {
                        string = 'window.c6.addSponsoredCard(\'3507986\',\'6603289\',\'rc-0a8a41066c1c7b\', \'http://adserver.adtechus.com/adlink/5491/3507986/0/277/AdId=6603289;BnId=1;itime=36041800;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals;nodecode=yes,;link=\' ,\'http://adserver.adtechus.com/adcount/3.0/5491/3507986/0/277/AdId=6603289;BnId=1;ct=45017356;st=31604;adcid=1;itime=36041800;reqtype=5;;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals\',\'\' );\u000A\u000D\u000A\u000D\u000A';
                        result = ADTECHBannerClient.__parseBanner__(string);
                    });

                    it('should return the banner info as an object', function() {
                        expect(result).toEqual({
                            placementId: '3507986',
                            campaignId: '6603289',
                            externalId: 'rc-0a8a41066c1c7b',
                            clickUrl: 'http://adserver.adtechus.com/adlink/5491/3507986/0/277/AdId=6603289;BnId=1;itime=36041800;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals;nodecode=yes,;link=',
                            countUrl: 'http://adserver.adtechus.com/adcount/3.0/5491/3507986/0/277/AdId=6603289;BnId=1;ct=45017356;st=31604;adcid=1;itime=36041800;reqtype=5;;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals'
                        });
                    });

                    describe('if an invalid banner is provided', function() {
                        var error;

                        beforeEach(function() {
                            error = new Error('Banner is not a sponsored card banner.');

                            string = 'document.write(\'<a href=\"http://adserver.adtechus.com/?adlink/5491/350798/0/0/AdId=-8;BnId=0;itime=0;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals;\" target=\"_blank\"><img src=\"http://aka-cdn-ns.adtechus.com/images/Default_Size_16_1x1.gif\" border=\"0\" alt=\"AdTech Ad\" width=\"0\" height=\"0\"/></a>\');\n var adcount_350798_1_=new Image();\nadcount_350798_1_.src=\"http://adserver.adtechus.com/adcount/3.0/5491/350798/0/0/AdId=-8;BnId=0;ct=1219819176;st=43106;adcid=1;itime=0;reqtype=5;;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals\"; \n';
                        });

                        it('should throw an Error', function() {
                            expect(function() { ADTECHBannerClient.__parseBanner__(string); }).toThrow(error);
                        });
                    });

                    describe('if the banner uses double quotes', function() {
                        beforeEach(function() {
                            string = string.replace(/'/g, '"');
                        });

                        it('should still be parseable', function() {
                            expect(ADTECHBannerClient.__parseBanner__(string)).toEqual(result);
                        });
                    });
                });
            });
        });
    });

    describe('instance:', function() {
        var config;
        var client;

        beforeEach(function() {
            config = {
                protocol: 'http:',
                server: 'adserver5.adtechus.com',
                network: '5473.87',
                keepAlive: false,
                maxSockets: 50,
                timeout: 30000
            };

            client = new ADTECHBannerClient(config);
        });

        it('should create a new request instance', function() {
            expect(request.defaults).toHaveBeenCalledWith({
                pool: { maxSockets: config.maxSockets },
                timeout: config.timeout,
                forever: config.keepAlive
            });
        });

        describe('if created without a config', function() {
            beforeEach(function() {
                request.defaults.calls.reset();
                client = new ADTECHBannerClient();
            });

            it('should use a default server, network, timeout and maxSockets', function() {
                expect(client.protocol).toBe('https:');
                expect(client.server).toBe('adserver.adtechus.com');
                expect(client.network).toBe('5491.1');
                expect(client.maxSockets).toBe(250);
                expect(client.timeout).toBe(3000);
                expect(client.keepAlive).toBe(true);
            });

            it('should configure the request instance with the defaults', function() {
                expect(request.defaults).toHaveBeenCalledWith({
                    pool: { maxSockets: client.maxSockets },
                    timeout: client.timeout,
                    forever: client.keepAlive
                });
            });
        });

        describe('@public', function() {
            describe('properties:', function() {
                describe('protocol', function() {
                    it('should be the configured protocol', function() {
                        expect(client.protocol).toBe(config.protocol);
                    });
                });

                describe('server', function() {
                    it('should be the configured server', function() {
                        expect(client.server).toBe(config.server);
                    });
                });

                describe('network', function() {
                    it('should be the configured network', function() {
                        expect(client.network).toBe(config.network);
                    });
                });

                describe('maxSockets', function() {
                    it('should be the configured maxSockets', function() {
                        expect(client.maxSockets).toBe(50);
                    });
                });

                describe('keepAlive', function() {
                    it('should be the configured keepAlive', function() {
                        expect(client.keepAlive).toBe(config.keepAlive);
                    });
                });

                describe('timeout', function() {
                    it('should be the configured timeout', function() {
                        expect(client.timeout).toBe(config.timeout);
                    });
                });
            });

            describe('methods:', function() {
                describe('get(...args)', function() {
                    var result;

                    beforeEach(function() {
                        result = client.get('foo', 'bar', true);
                    });

                    it('should return a promise', function() {
                        expect(result).toEqual(jasmine.any(Promise));
                    });

                    it('should call its request() with the provided args', function() {
                        expect(localRequest.get).toHaveBeenCalledWith('foo', 'bar', true);
                    });
                });

                describe('getBanner(placement, campaignId, bannerId, uuid)', function() {
                    var placement, campaignId, bannerId, uuid;
                    var getDeferred;
                    var success, failure;
                    var result;

                    beforeEach(function() {
                        placement = '34875349';
                        campaignId = '6603289';
                        bannerId = '7849543';
                        uuid = '839tuy8549';

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        getDeferred = q.defer();
                        spyOn(client, 'get').and.returnValue(getDeferred.promise);

                        result = client.getBanner(placement, campaignId, bannerId, uuid);
                        result.then(success, failure);
                    });

                    it('should make a request to ADTECH', function() {
                        expect(client.get).toHaveBeenCalledWith(client.__makeURL__('addyn', placement, {
                            adid: campaignId,
                            bnid: bannerId
                        }));
                    });

                    describe('when the request succeeds', function() {
                        var string;

                        beforeEach(function(done) {
                            string = 'window.c6.addSponsoredCard(\'3507986\',\'6603289\',\'rc-0a8a41066c1c7b\',\'http://adserver.adtechus.com/adlink/5491/3507986/0/277/AdId=6603289;BnId=1;itime=36041800;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals;nodecode=yes;link=\',\'http://adserver.adtechus.com/adcount/3.0/5491/3507986/0/277/AdId=6603289;BnId=1;ct=45017356;st=31604;adcid=1;itime=36041800;reqtype=5;;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals\',\'\' );\u000A\u000D\u000A\u000D\u000A';
                            getDeferred.resolve(string);

                            result.finally(done);
                        });

                        it('should fulfill with the parsed banner', function() {
                            expect(success).toHaveBeenCalledWith(ADTECHBannerClient.__parseBanner__(string));
                        });
                    });
                });

                describe('getBanners(amount, placement, sizes, keywords, uuid)', function() {
                    var amount, placement, sizes, keywords, uuid;
                    var success, failure;
                    var getDeferred;
                    var result;

                    beforeEach(function() {
                        amount = 3;
                        placement = '734657384';
                        sizes = ['2x2', '1x1'];
                        keywords = {
                            kwlp1: 'cam-c95b0144fc7bf4',
                            kwlp3: 'foo+bar'
                        };
                        uuid = 'fu3iyr489';

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        getDeferred = q.defer();
                        spyOn(client, 'get').and.returnValue(getDeferred.promise);

                        result = client.getBanners(amount, placement, sizes, keywords, uuid);
                        result.then(success, failure);
                    });

                    describe('if amount is 0', function() {
                        beforeEach(function(done) {
                            amount = 0;
                            success.calls.reset();
                            failure.calls.reset();
                            client.get.calls.reset();

                            client.getBanners(amount, placement, sizes, keywords, uuid).then(success, failure).finally(done);
                        });

                        it('should fulfill with an empty array', function() {
                            expect(success).toHaveBeenCalledWith([]);
                        });

                        it('should not call get()', function() {
                            expect(client.get).not.toHaveBeenCalled();
                        });
                    });

                    it('should make a request to ADTECH', function() {
                        expect(client.get).toHaveBeenCalledWith(client.__makeURL__('multiad', 0, extend(keywords, {
                            mode: 'json',
                            plcids: '734657384,734657384,734657384',
                            Allowedsizes: sizes.join(',')
                        })), { json: true });
                    });

                    describe('when the server responds', function() {
                        var response;

                        beforeEach(function(done) {
                            response = {
                                "ADTECH_MultiAd": [
                                    {
                                        "PlacementId": "3507986",
                                        "AdId": "6614363",
                                        "Alias": "",
                                        "Ad": {
                                            "AdCode": "window.c6.addSponsoredCard('3507986','6614363','rc-d778c1d6c8a183','http://adserver.adtechus.com/adlink/5491/3507986/0/277/AdId=6614363;BnId=1;itime=39652931;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals;nodecode=yes;link=','http://adserver.adtechus.com/adcount/3.0/5491/3507986/0/277/AdId=6614363;BnId=1;ct=3655819635;st=1279;adcid=1;itime=39652931;reqtype=5;;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals','' );\n\r\n\r\n",
                                            "Creative": {
                                                "SizeId": "277",
                                                "SizeWidth": "2",
                                                "SizeHight": "2",
                                                "BnId": "1"
                                            }
                                        }
                                    },
                                    {
                                        "PlacementId": "3507985",
                                        "AdId": "-8",
                                        "Alias": "",
                                        "Ad": {
                                            "AdCode": "document.write('<a href=\"http://adserver.adtechus.com/?adlink/5491/3507985/0/0/AdId=-8;BnId=0;itime=0;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals;\" target=\"_blank\"><img src=\"http://aka-cdn-ns.adtechus.com/images/Default_Size_16_1x1.gif\" border=\"0\" alt=\"AdTech Ad\" width=\"0\" height=\"0\"/></a>');\n var adcount_3507985_1_=new Image();\nadcount_3507985_1_.src=\"http://adserver.adtechus.com/adcount/3.0/5491/3507985/0/0/AdId=-8;BnId=0;ct=3655819635;st=3998;adcid=1;itime=0;reqtype=5;;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals\"; \n",
                                            "Creative": {
                                                "SizeId": "0",
                                                "SizeWidth": "0",
                                                "SizeHight": "0",
                                                "BnId": "0"
                                            }
                                        }
                                    },
                                    {
                                        "PlacementId": "3507986",
                                        "AdId": "6603289",
                                        "Alias": "",
                                        "Ad": {
                                            "AdCode": "window.c6.addSponsoredCard('3507986','6603289','rc-0a8a41066c1c7b','http://adserver.adtechus.com/adlink/5491/3507986/0/277/AdId=6603289;BnId=1;itime=39652939;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals;nodecode=yes;link=','http://adserver.adtechus.com/adcount/3.0/5491/3507986/0/277/AdId=6603289;BnId=1;ct=3655819635;st=5008;adcid=1;itime=39652939;reqtype=5;;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals','' );\n\r\n\r\n",
                                            "Creative": {
                                                "SizeId": "277",
                                                "SizeWidth": "2",
                                                "SizeHight": "2",
                                                "BnId": "1"
                                            }
                                        }
                                    }
                                ]
                            };

                            getDeferred.resolve(response);
                            result.finally(done);
                        });

                        it('should fulfill with an array of parsed banners', function() {
                            expect(success).toHaveBeenCalledWith([
                                ADTECHBannerClient.__parseBanner__(response.ADTECH_MultiAd[0].Ad.AdCode),
                                ADTECHBannerClient.__parseBanner__(response.ADTECH_MultiAd[2].Ad.AdCode)
                            ]);
                        });
                    });
                });
            });
        });

        describe('@private', function() {
            describe('methods:', function() {
                describe('__makeURL__(type, placement, params)', function() {
                    var type, placement, params;
                    var result;

                    beforeEach(function() {
                        type = 'addyn';
                        placement = '34875349';
                        params = {
                            mode: 'json',
                            plcids: '34875349,34875349,34875349,34875349',
                            Allowedsizes: '2x2',
                            kwlp1: 'cam-c95b0144fc7bf4',
                            kwlp3: 'foo+bar+hello+world',
                            no: undefined,
                            nully: null,
                            foo: false,
                            num: 0
                        };

                        result = client.__makeURL__(type, placement, params);
                    });

                    it('should create an ADTECH URL', function() {
                        expect(result).toBe('http://adserver5.adtechus.com/addyn/3.0/5473.87/34875349/0/-1/mode=json;plcids=34875349,34875349,34875349,34875349;Allowedsizes=2x2;kwlp1=cam-c95b0144fc7bf4;kwlp3=foo+bar+hello+world;nully=;foo=false;num=0;target=_blank;misc=' + Date.now() + ';cfp=1');
                    });

                    describe('if the type is "multiad"', function() {
                        beforeEach(function() {
                            type = 'multiad';

                            result = client.__makeURL__(type, placement, params);
                        });

                        it('should force the placement to being 0', function() {
                            expect(result).toContain('http://adserver5.adtechus.com/multiad/3.0/5473.87/0/0/-1/');
                        });
                    });
                });
            });
        });
    });
});
