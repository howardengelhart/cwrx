(function(){
    'use strict';

    var __ut__      = (global.jasmine !== undefined) ? true : false,
        __require__ = require,
        __injector__;

    function Injector(){

        var _depsCache = {};
        
        // Store a depenency in the cache, mostly for mocks
        this.configure = function(alias,dependency,allowOverride) {
            if (_depsCache[alias] !== undefined){
                if ((_depsCache[alias] !== dependency) && (!allowOverride)){
                    throw new Error('Cannot overwrite dependency \'' + alias + '\'');
                }
            }
            _depsCache[alias] = dependency;
            return this;
        };

        // Inject a depenency into your current context
        this.inject = function(dependency){
            if (_depsCache[dependency] !== undefined){
                return _depsCache[dependency];
            }

            throw new Error('Unable to locate dependency: \'' + dependency + '\'');
        };

        // Will inject if its there, otherwise will attempt to require it in.
        this.require = function(dependency){
            if (_depsCache[dependency] !== undefined){
                return _depsCache[dependency];
            }

            _depsCache[dependency] = __require__(dependency);

            return _depsCache[dependency];
        };

        if (__ut__){
            this.privateData = _depsCache;
        }
    }

    __injector__ = new Injector();

    if (__ut__){
        module.exports.reset = function(mockRequire){
            __injector__ = new Injector();
            __require__  = mockRequire;
            return __injector__;
        };
    }

    module.exports.createInjector = function() {
        return new Injector();
    };

    module.exports.configure = function(){
        __injector__.configure.apply(__injector__,arguments);
        return module.exports;
    };

    module.exports.inject = function(){
        return __injector__.inject.apply(__injector__,arguments);
    };

    module.exports.require = function(){
        return __injector__.require.apply(__injector__,arguments);
    };
}());
