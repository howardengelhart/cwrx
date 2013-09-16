var request = require("request"),
    fs      = require("fs"),
    path    = require("path"),

    configFile = fs.readFileSync(path.join(__dirname, "dub_e2e_config.json")),
    config = JSON.parse(configFile);
if (!config.url) throw new Error("expected a url field in config file.");

describe("dub server:", function() {
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

    describe("valid template test - scream", function() {
        it("should successfully send a request to the dub server", function() {
            templateFile = fs.readFileSync(path.join(__dirname, "Templates/scream_template.json"));
            expect(templateFile).toBeDefined();
            templateJSON = JSON.parse(templateFile);
            expect(templateJSON).toBeDefined();

            var options = {
                url: config.url,
                json: templateJSON
            }, reqFlag = false;
            
            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(error).toBeNull();
                    expect(body).toBeDefined();
                    if (body) {
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
    describe("valid template test - siri", function() {
        it("should successfully send a request to the dub server", function() {
            templateFile = fs.readFileSync(path.join(__dirname, "Templates/siri_template.json"));
            expect(templateFile).toBeDefined();
            templateJSON = JSON.parse(templateFile);
            expect(templateJSON).toBeDefined();

            var options = {
                url: config.url,
                json: templateJSON
            }, reqFlag = false;
            
            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(error).toBeNull();
                    expect(body).toBeDefined();
                    if (body) {
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
                url: config.url,
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

