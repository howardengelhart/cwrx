var request = require("request"),
    fs      = require("fs"),
    path    = require("path"),
    url     = require("url"),
    configFile = fs.readFileSync(path.join(__dirname, "dub_e2e_config.json")),
    config = JSON.parse(configFile);

describe("dub video server:", function() {
    var templateFile, templateJSON;
    
    afterEach(function() { 
        if (templateJSON.e2e && templateJSON.e2e.clean_caches) {
            var options = {
                url : config.clean_cache_url,
                json: templateJSON
            }
            request.post(options, function(error, response, body) {
                if (error) console.log("Error cleaning caches: " + error);
            });
        }
    });

    describe("uncached valid template test - scream", function() {
        it("should successfully send a request to the dub server", function() {
            templateFile = fs.readFileSync(path.join(__dirname, "Templates/scream_template.json"));
            expect(templateFile).toBeDefined();
            templateJSON = JSON.parse(templateFile);
            expect(templateJSON).toBeDefined();

            var options = {
                url: config.video_url,
                json: templateJSON
            }, reqFlag = false;
            
            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(error).toBeNull();
                    expect(body).toBeDefined();
                    if (body) {
                        expect(body['error']).not.toBeDefined();
                        expect(body["output"]).toBeDefined();
                        expect(typeof(body["output"])).toEqual("string");
                        expect(body["md5"]).toBeDefined();
                        expect(body["md5"]).toEqual(templateJSON["e2e"]["md5"]);
                    }
                    reqFlag = true;
                });            
            });
            waitsFor(function() { return reqFlag }, 30000);
        });
    });
    describe("cached valid template test - siri", function() {
        it("should successfully send a request to the dub server", function() {
            templateFile = fs.readFileSync(path.join(__dirname, "Templates/siri_template.json"));
            expect(templateFile).toBeDefined();
            templateJSON = JSON.parse(templateFile);
            expect(templateJSON).toBeDefined();

            var options = {
                url: config.video_url,
                json: templateJSON
            }, reqFlag = false;
            
            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(error).toBeNull();
                    expect(body).toBeDefined();
                    if (body) {
                        expect(body['error']).not.toBeDefined();
                        expect(body["output"]).toBeDefined();
                        expect(typeof(body["output"])).toEqual("string");
                        expect(body["md5"]).toBeDefined();
                        expect(body["md5"]).toEqual(templateJSON["e2e"]["md5"]);
                    }
                    reqFlag = true;
                });            
            });
            waitsFor(function() { return reqFlag }, 30000);
        });
    });
    describe("missing script test", function() {
        it("should unsuccessfully send a request to the dub server", function() {
            templateFile = fs.readFileSync(path.join(__dirname, "Templates/missing_script.json"));
            expect(templateFile).toBeDefined();
            templateJSON = JSON.parse(templateFile);
            expect(templateJSON).toBeDefined();

            var options = {
                url: config.video_url,
                json: templateJSON
            }, reqFlag = false;
            
            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(body).toBeDefined();
                    if (body) {
                        expect(body['error']).toBeDefined();
                        expect(body['detail']).toBeDefined();
                        expect(body['detail']).toEqual("Expected script section in template");
                    }
                    reqFlag = true;
                });            
            });
            waitsFor(function() { return reqFlag }, 30000);
        });
    });
});

describe("dub share server:", function() {
    describe("valid script test - scream", function() {
        var scriptId;
        it("should successfully send a request to the dub server", function() {
            var scriptFile = fs.readFileSync(path.join(__dirname, "Templates/scream_template.json"));
            expect(scriptFile).toBeDefined();
            var scriptJSON = JSON.parse(scriptFile);
            expect(scriptJSON).toBeDefined();

            var options = {
                url: config.share_url,
                json: scriptJSON
            }, reqFlag = false;

            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(body).toBeDefined();
                    expect(error).toBeNull();
                    if(body) {
                        expect(body['error']).not.toBeDefined();
                        expect(body["url"]).toBeDefined();
                        var split_url_path = url.parse(body['url'], true)['pathname'].split('/');
                        scriptId = split_url_path[split_url_path.length - 1];
                    }
                    reqFlag = true;
                });
            });
            waitsFor(function() { return reqFlag }, 30000);
        });
        it("should successfully clean up after itself", function() {
            expect(scriptId).toBeDefined();
            if (!scriptId) return;
            var options = {
                url : config.remove_script_url,
                json: {
                    fname: scriptId + '.json'
                }
            }
            request.post(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body['error']).not.toBeDefined();
                
            });
        });
    });
});



