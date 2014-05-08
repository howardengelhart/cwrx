
var util = require('util'),
    q    = require('q'),
    cmdl = require('commander');

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

function CmdlView(cmdl) {
    this.cmdl = cmdl;
    this.data = {};
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
        key = prompt;
    }
    if (prompt.toLowerCase().match(/password/)){
        method = 'promptPassword';
    }
    this.cmdl[method].call(this.cmdl,prompt,function(res){
        self.data[key] = res || defaultVal;
        def.resolve(self.data);
    });
    return def.promise;
}

function registerCmdlView(constructor){
    function wrapper(){
        CmdlView.call(this,cmdl);
        constructor.call(this);
    }
    util.inherits(wrapper,CmdlView); 
    return wrapper;
}

////////////////////////////////////////////////////////////
//
var CreateUserView = registerCmdlView(function() {
    this.presentView = function(){
        var self = this;
        return self.doPrompt('prompt1 ', 'p1')
        .then(function(){
            return self.doPrompt('prompt2 ', 'p2');
        })
        .then(function(){
            return self.doPrompt('prompt3 ', 'p3');
        });
    };
});

console.log('Start');
var o = new CreateUserView();
o.presentView()
.then(function(result){
    console.log(result);
    console.log('End');
    process.exit(0);
})
.catch(function(err){
    console.log(err);
    process.exit(1);
});
