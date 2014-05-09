var util    = require('util'),
    q       = require('q'),
    cmdl    = require('commander'),
    MVC     = {},
    _deps   = {};


////////////////////////////////////////////////////////////
//
MVC.View  = function(){
    this.viewDelegate = null;
};

MVC.View.prototype.initView = function(delegate){
    this.viewDelegate = delegate;
};

MVC.View.prototype.presentView = function(){
    return q.when({});
};

MVC.View.Subclass = function(constructor){
    function wrapper() {
        MVC.View.call(this);
        constructor.call(this);
    }
    util.inherits(wrapper,MVC.View);
    return wrapper;
};

////////////////////////////////////////////////////////////
//

MVC.Controller = function(view,model) {
    this.view   = view;
    this.model  = model;
};

MVC.Controller.prototype.showView = function(){
    return this.view.presentView();
};

MVC.Controller.prototype.onData = function(){

};


////////////////////////////////////////////////////////////
//

MVC.CmdlView = MVC.View.Subclass(function() {
    this.cmdl       = require('commander');
    this.cmdl.promptPassword = cmdl.password;
});

MVC.CmdlView.Subclass = function(constructor){
    function wrapper() {
        MVC.CmdlView.call(this);
        constructor.call(this);
    }
    util.inherits(wrapper,MVC.CmdlView);
    return wrapper;
};

MVC.CmdlView.prototype.doPrompt = function(prompt, storage){
    var self = this, def = q.defer(), method = 'prompt', key, defaultVal;
    if (typeof storage === 'string'){
        key = storage;
        storage ={};
        storage[key] = null;
    }
    for (key in storage){
        defaultVal = storage[key];
        break;
    }
    if (!key){
        key = prompt.replace(/^\s*(\S*)\s*/,'$1');
    }
    if (prompt.toLowerCase().match(/password/)){
        method = 'promptPassword';
    }
    if (defaultVal){
        prompt += ' [' + defaultVal + ']: ';
    } else {
        prompt += ': ';
    }
    this.cmdl[method].call(this.cmdl,prompt,function(res){
        try {
            self.viewDelegate.onData(key , res || defaultVal);
        }
        catch(e){
            def.reject(e);
        }
        def.resolve();
    });
    return def.promise;
};

MVC.defineController = function(constructor,ViewType,ModelType){
    function wrapper() {
        var view, model, deps;
        ViewType  = (ViewType  || constructor.$view);
        ModelType = (ModelType || constructor.$model);
        if (!ViewType){
            throw new Error('Must provide a view for controller!');
        }
        view = new ViewType();

        if (ModelType){
            model = new ModelType();
        }

        MVC.Controller.call(this, view, model);
        
        if (constructor.$deps){
            constructor.$deps.forEach(function(depName){
                if (!_deps[depName]){
                    throw new Error('Unable to locate dependency: ' + depName);
                }
                if (!deps){
                    deps = [];
                }
                deps.push(_deps[depName]);
            });
        }

        constructor.apply(this,deps);

        view.initView(this);
    }
    
    util.inherits(wrapper,MVC.Controller);
    return wrapper;
};

MVC.createController = function(constructor,ViewType,ModelType){
    return new (MVC.defineController(constructor,ViewType,ModelType))();
};

MVC.registerDependency = function(name,dep){
    _deps[name] = dep;
};

MVC.clearDependencies = function(){
    _deps = {};
};

module.exports = MVC;

