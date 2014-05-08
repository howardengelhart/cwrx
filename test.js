
var util = require('util'),
    q    = require('q'),
    cmdl = require('commander'),
    uuid = require('./lib/uuid');

    cmdl.promptPassword = cmdl.password;
////////////////////////////////////////////////////////////
//
function View() {

}

View.prototype.presentView = function(){
    return q.when({});
};

function registerView(constructor){
    function wrapper(){
        View.call(this);
        constructor.call(this);
    }
    util.inherits(wrapper,View);
    return wrapper;
}

////////////////////////////////////////////////////////////
//

function Controller(view,model) {
    this.view   = view;
    this.model  = model;
};

Controller.prototype.showView = function(){
    return this.view.presentView();
}

Controller.prototype.onData = function(){

};


////////////////////////////////////////////////////////////
//

function CmdlView(cmdl, delegate) {
    this.cmdl       = cmdl;
    this.delegate   = delegate;
}
util.inherits(CmdlView,View);

CmdlView.prototype.doPrompt = function(prompt, storage){
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
        prompt += ' [' + defaultVal + ']: '
    } else {
        prompt += ': ';
    }
    this.cmdl[method].call(this.cmdl,prompt,function(res){
        try {
            self.delegate.onData(key , res || defaultVal);
        }
        catch(e){
            def.reject(e);
        }
        def.resolve();
    });
    return def.promise;
}

function createCmdlView(constructor,delegate){
    function wrapper(delegate){
        CmdlView.call(this,cmdl,delegate);
        constructor.call(this);
    }
    util.inherits(wrapper,CmdlView); 
    return new wrapper(delegate);
}

function createCmdlController(constructor){
    function wrapper(){
        var view = createCmdlView(constructor.$view,this),
            model = (constructor.$model) ? (new constructor.$model()) : undefined;
        Controller.call(this,view,model);
        constructor.call(this);
    }
    util.inherits(wrapper,Controller);
    return new wrapper();
}

////////////////////////////////////////////////////////////
//

function UserModel () {
    _email     = null;
    _password  = null;
    _password2 = null;
    _orgId     = null;

    function validatePassword(p1,p2){
        if  ((p1 && p2) && (p1 !== p2)){
            throw new Error('Passwords much match!');
        }
        
        if (p1.length < 8){
            throw new Error('Password must be at least 8 chars.');
        }
        return p1;
    }
   
    function validateEmail(v){
        if (!v.match(/^.*@.*\.\w+$/)){
            throw new TypeError('Invalid email.');
        }
        return v;
    }

    Object.defineProperty(this,'email',{
        enumerable : true,
        set : function(v){ _email = validateEmail(v); },
        get : function() { return _email; } 
    });

    Object.defineProperty(this,'password',{
        enumerable: true,
        set : function(v){ _password = validatePassword(v,_password2); },
        get : function() { return _password; } 
    });
    
    Object.defineProperty(this,'password2',{
        set : function(v){ _password2 = validatePassword(v,_password1); },
        get : function() { return _password2; } 
    });
    
    Object.defineProperty(this,'orgId',{
        enumerable: true,
        set : function(v){ _orgId = v; },
        get : function() { return _orgId; } 
    });
}

function NewUserView() {
    this.presentView = function(){
        var self = this;
        return self.doPrompt('email' )
        .then(function(){
            return self.doPrompt('password')
                .catch(function(e){
                    console.log(e.message);
                    return self.doPrompt('password')
                });
        })
        .then(function(){
            return self.doPrompt('repeat password','password2')
                .catch(function(e){
                    console.log(e.message);
                    return self.doPrompt('repeat password','password2')
                });
        })
        .then(function(){
            var defaultOrg = 'o-' + uuid.createUuid().substr(0,14);
            return self.doPrompt('organization',{ orgId : defaultOrg });
        });
    };
}

function NewUserController(){
    var self = this;

    self.onData = function(key,val){
        self.model[key] = val;
    };

    self.submit = function(){

    };
}

NewUserController.$view  = NewUserView;
NewUserController.$model = UserModel;

function LoginView() {
    this.presentView = function(){
        var self = this;
        return self.doPrompt('email' )
        .then(function(){
            return self.doPrompt('password')
                .catch(function(e){
                    console.log(e.message);
                    return self.doPrompt('password')
                });
        })
        .then(function(){
            return self.doPrompt('repeat password','password2')
                .catch(function(e){
                    console.log(e.message);
                    return self.doPrompt('repeat password','password2')
                });
        })
        .then(function(){
            var defaultOrg = 'o-' + uuid.createUuid().substr(0,14);
            return self.doPrompt('organization',{ orgId : defaultOrg });
        });
    };
}

console.log('Start');
var c = createCmdlController(NewUserController);

c.showView()
.then(function(){
    console.log(c.model);
    console.log('End');
    process.exit(0);
})
.catch(function(err){
    console.log(err.stack);
    process.exit(1);
});
/*
var m = new UserModel();
m.email = 'abc@some.com';
*/
