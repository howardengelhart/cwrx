var util    = require('util'),
    q       = require('q'),
    cmdl    = require('commander'),
    MVC     = {},
    _deps   = {};


////////////////////////////////////////////////////////////
//
MVC.View  = function(){

};

MVC.View.prototype.initView = function(){

};

MVC.View.prototype.presentView = function(){
    return q.when({});
};

MVC.View.prototype.alert = function(){

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

MVC.Controller.prototype.initView = function(){
    return this.view.initView.apply(this.view,arguments);
};

MVC.Controller.prototype.showView = function(){
    return this.view.presentView();
};

MVC.Controller.prototype.onData = function(){

};

////////////////////////////////////////////////////////////
//

MVC.CmdlView = MVC.View.Subclass(function() {
    this.cmdl           = require('commander');
    this.title          = null;
    this.prompts        = [];
    this.defaultBinding = null;
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

MVC.CmdlView.prototype.alert = function(){
    console.log.apply(console,arguments);
};

MVC.CmdlView.prototype.initView = function(title,prompts,defaultBinding){
    this.title = title;
    this.defaultBinding = defaultBinding;
    if (prompts){
        this.prompts = prompts;
    }
};

MVC.CmdlView.prototype.presentView = function(){
    if (!this.prompts){
        return q({});
    }

    if (this.title){
        var i, line = '', lineLen = Math.max(this.title.length,40);
        for (i = 0; i < lineLen; i++){
            line += '-';
        }
        console.log('');
        console.log(line);
        console.log(this.title);
        console.log(line);
    }

    var self = this, def = q.defer(), prompts = self.prompts.concat();
    (function exec(){
        var promptObj;
        if (!prompts || (prompts.length === 0)){
            return def.resolve({});
        }
    
        promptObj = prompts.shift();
        self.doPrompt(promptObj)
        .then(function(){
            exec();
        })
        .catch(function(err){
            return def.reject(err);
        });
    }());

    return def.promise;
};

MVC.CmdlView.prototype.doPrompt = function(promptObj){
    var self = this, def = q.defer(), method = 'prompt', working = {};
    ['label','alias','defaultVal','repeat','binding'].forEach(function(prop){
        working[prop] = promptObj[prop];
    });
    if (!working.alias){
        working.alias = working.label.replace(/^\s*(\S*)\s*/,'$1');
    }

    if (!working.binding){
        working.binding = self.defaultBinding;
    }

    if (working.label.toLowerCase().match(/password/)){
        method = 'promptPassword';
    }
    if (working.defaultVal){
        working.label += ' [' + working.defaultVal + ']: ';
    } else {
        working.label += ': ';
    }

    (function doCall(w){
        self.cmdl[method].call(self.cmdl,w.label,function(res){
            try {
                if (w.binding ) {
                    if (typeof w.binding === 'function'){
                        w.binding.call(null,w.alias, res || w.defaultVal);
                    }
                    else if (typeof w.binding === 'object'){
                        w.binding[w.alias] = res || w.defaultVal;
                    }
                }
            }
            catch(e){
                if (e.message){
                    console.log('Error: ',e.message);
                }
                if (w.repeat) {
                    w.repeat -= 1;
                    return doCall(w);
                }
                return def.reject(e);
            }
            def.resolve();
        });
    }(working));

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
    }
    
    util.inherits(wrapper,MVC.Controller);
    return wrapper;
};

MVC.createController = function(){
    return new (MVC.defineController.apply(null,arguments))();
};

MVC.launchController = function(){
    return MVC.createController.apply(null,arguments).run();
};

MVC.registerDependency = function(name,dep){
    _deps[name] = dep;
};

MVC.clearDependencies = function(){
    _deps = {};
};

module.exports = MVC;

