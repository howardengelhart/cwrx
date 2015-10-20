(function(){
    'use strict';
    
    var q = require('q');
        
    var LOCKED_VALUE = 'LOCKED';
    
    var CacheMutex = function(cache, lockName, cacheTTL) {
        this._init(cache, lockName, cacheTTL);
    };
    
    /* Private method to construct a new CacheMutex instance. */
    CacheMutex.prototype._init = function(cache, lockName, cacheTTL) {
        this._cache = cache;
        this._lockName = lockName;
        this._hasLock = false;
        this._ttl = cacheTTL;
    };
    
    /* Acquires the lock if it is able and returns true.
     * If the lock cannot be aquired returns false. */
    CacheMutex.prototype.acquire = function() {
        var self = this;
        
        return self._cache.add(self._lockName, LOCKED_VALUE, self._ttl)
            .then(function(value) {
                var locked = !(value);
                self._hasLock = !locked;
                return locked;
            });
    };
    
    /* Releases the lock if it exists. */
    CacheMutex.prototype.release = function() {
        var self = this;
        
        if(self._hasLock) {
            return self._cache.delete(self._lockName)
                .then(function() {
                    self._hasLock = false;
                });
        } else {
            return q();
        }
    };

    module.exports = CacheMutex;
}());
