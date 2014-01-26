var q = require('q');

function Keeper(){
    var self = this;
    self._deferreds = {};

    Object.defineProperty(self,'pendingCount', {
        get : function() {
            var result = 0; 
            Object.keys(self._deferreds).forEach(function(key){
                result += self._deferreds[key].promise.isPending() ? 1 : 0; 
            });
            return result;
        }
    });
    
    Object.defineProperty(self,'completedCount', {
        get : function() {
            var result = 0; 
            Object.keys(self._deferreds).forEach(function(key){
                result += self._deferreds[key].promise.isPending() ? 0 : 1; 
            });
            return result;
        }
    });
    
    Object.defineProperty(self,'fulfilledCount', {
        get : function() {
            var result = 0; 
            Object.keys(self._deferreds).forEach(function(key){
                result += self._deferreds[key].promise.isFulfilled() ? 1 : 0; 
            });
            return result;
        }
    });
    
    Object.defineProperty(self,'rejectedCount', {
        get : function() {
            var result = 0; 
            Object.keys(self._deferreds).forEach(function(key){
                result += self._deferreds[key].promise.isRejected() ? 1 : 0; 
            });
            return result;
        }
    });
}

Keeper.prototype.defer = function(id,timeout){
    var self = this, deferred;
   
    deferred = self._deferreds[id];
    if (deferred){
        if (deferred.promise.isPending()){
            return deferred;
        }
    }
    
    deferred = q.defer();
    deferred.keeperId           = id;
    deferred.keeperCreateTime   = new Date();
    self._deferreds[id]         = deferred;

    return deferred;
};

Keeper.prototype.getDeferred = function(id,force){
    var self = this, deferred;

    deferred = self._deferreds[id];
    if (deferred){
        if (!deferred.promise.isPending() && !force){
            deferred = undefined;
        }
    }
    
    return deferred;
};

Keeper.prototype.remove = function(id,force){
    var self = this, deferred = self.getDeferred(id,force);
    delete self._deferreds[id];
    return deferred;
};

Keeper.prototype.removeCompleted = function(){
    var self = this;
    Object.keys(self._deferreds).forEach(function(key){
        if (!self._deferreds[key].promise.isPending()){
            delete self._deferreds[key];
        }
    });

    return self;
};

Keeper.prototype.resolveAll = function(val){
    var self = this;
    Object.keys(self._deferreds).forEach(function(key){
        if (!self._deferreds[key].promise.isPending()){
            return;
        }
        if (val){
            self._deferreds[key].resolve(val);
        } else {
            self._deferreds[key].resolve(key);
        }
    });

    return self;
};

Keeper.prototype.rejectAll = function(val){
    var self = this;
    Object.keys(self._deferreds).forEach(function(key){
        if (!self._deferreds[key].promise.isPending()){
            return;
        }
        if (val){
            self._deferreds[key].reject(val);
        } else {
            self._deferreds[key].reject(key);
        }
    });

    return self;
};

module.exports.Keeper = Keeper;
