/**
 * This is a convenience module for the unit tests.  It helps facilitate the 
 * mocking of dependencies "required" by the module you are testing by 
 * providing methods for removing modules from the cache, adding mocks
 * to the injector, and then requiring back the tested module.
 *
 * Usage:
 *
 *   assemble = sanitize(['../lib/assemble'])
 *              .andConfigure( [ ['./ffmpeg',mockFFmpeg], ['./id3', mockId3Info ]])
 *              .andRequire();
 *
 * IMPORTANT:  due to the jasmine-node execution ordering, you need to run the sanitize
 * in the beforeEach, afterEach, or it test methods.  Running a sanitize 
 * outside of these methods will lead to your mock configurations likely being
 * lost between runs.
 *
 */
var util = require('util');

var _configure, _require,
    _sanitize = function(dirty){
    if (dirty){
        if (!util.isArray(dirty)){
            dirty = [dirty];
        }
        dirty.forEach(function(mod){
            try {
                mod = require.resolve(mod);
            }
            catch(e){
            }
            delete require.cache[mod];
        });
    } 
    return {
        andConfigure : function(injectible) {
                        _configure(injectible);
                        return this;
                       },
        andRequire:     function(dps){
                            if (!dps){
                                dps = dirty;
                            }

                            return _require(dps);
                        }
    };
};

_configure = function(injectible){
    _sanitize('../lib/inject'); 
    if (!util.isArray(injectible)){
        injectible = [injectible];
    }
    var injector = require('../lib/inject');

    injectible.forEach(function(params){
        injector.configure.apply(injector,params); 
    });

    return module.exports;
};

_require = function(deps){
    var result;
    if (deps){
        if (!util.isArray(deps)){
            deps = [deps];
        }
        
        deps.forEach(function(mod){
            result = require(mod);
        });
    }
    return result;
};

module.exports = _sanitize;
