var request = require("request"),
    fs      = require("fs"),
    path    = require("path"),

    configFile = fs.readFileSync(path.join(__dirname, "dub_e2e_config.json")),
    config = JSON.parse(configFile);
if (!config.url) throw new Error("expected a url field in config file.");

describe("dub server:", function() {
    var templateFile, templateJSON;

    describe("valid template test - scream", function() {
        it("should load the template successfully", function() {
            templateFile = fs.readFileSync(path.join(__dirname, "scream_template.json"));
            expect(templateFile).toBeDefined();
            templateJSON = JSON.parse(templateFile);
            expect(templateJSON).toBeDefined();
        });

        it("should successfully send a request to the dub server", function() {
            var reqFlag = false, 
                options = {
                url: config.url,
                json: templateJSON
            }; 
            
            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(error).toBeNull();
                    expect(body).toBeDefined();
                    expect(body["output"]).toBeDefined();
                    expect(typeof(body["output"])).toEqual("string");
                    expect(body["md5"]).toBeDefined();
                    expect(body["md5"]).toEqual(templateJSON["e2e"]["md5"]);
                    // console.log(JSON.stringify(body));
                    reqFlag = true;
                });            
            });
            waitsFor(function() { return reqFlag; }, "Request took too long", 40000);
        });
    });
    describe("valid template test - siri", function() {
        it("should load the template successfully", function() {
            templateFile = fs.readFileSync(path.join(__dirname, "siri_template.json"));
            expect(templateFile).toBeDefined();
            templateJSON = JSON.parse(templateFile);
            expect(templateJSON).toBeDefined();
        });

        it("should successfully send a request to the dub server", function() {
            var reqFlag = false, 
                options = {
                url: config.url,
                json: templateJSON
            }; 
            
            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(error).toBeNull();
                    expect(body).toBeDefined();
                    expect(body["output"]).toBeDefined();
                    expect(typeof(body["output"])).toEqual("string");
                    expect(body["md5"]).toBeDefined();
                    expect(body["md5"]).toEqual(templateJSON["e2e"]["md5"]);
                    // console.log(JSON.stringify(body));
                    reqFlag = true;
                });            
            });
            waitsFor(function() { return reqFlag; }, "Request took too long", 40000);
        });
    });
    describe("missing script test", function() {
        it("should load the template successfully", function() {
            templateFile = fs.readFileSync(path.join(__dirname, "missing_script.json"));
            expect(templateFile).toBeDefined();
            templateJSON = JSON.parse(templateFile);
            expect(templateJSON).toBeDefined();
        });

        it("should unsuccessfully send a request to the dub server", function() {
            var reqFlag = false, 
                options = {
                url: config.url,
                json: templateJSON
            };
            
            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(body).toBeDefined();
                    expect(body['error']).toBeDefined();
                    expect(body['detail']).toBeDefined();
                    expect(body['detail']).toEqual("Expected script section in template");
                    reqFlag = true;
                });            
            });
            waitsFor(function() { return reqFlag; }, "Request took too long", 40000);
        });
    });

});

