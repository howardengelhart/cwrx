
var request = require('request'),
    util    = require('util'),
    path    = require('path'),
    q       = require('q'),
    cmdl    = require('commander'),
    uuid    = require('./lib/uuid'),
    MVC     = require('./lib/mvc'),
    app     = {
        data : {

        }
    }

log = function(){
    var args = Array.prototype.slice.call(arguments, 0);
    args.push('\n');
    process.stdout.write(args.join(' '));
};

parseCmdLine = function(){
    var cmdl = require('commander'),
        provData, authFile = path.join(process.env.HOME,'.c6prov.json'),
        data = {};

    if (fs.existsSync(authFile)){
        try {
            provData = fs.readJsonSync(authFile);
            data.email = provData.email;
            data.password = provData.password;
        }catch(e){
            log('Unable to read ' +  authFile);
        }
    }
    
    cmdl
        .option('-e, --email [email]','Logon.')
        .option('-s, --server [URL]','API Host.','https://staging.cinema6.com')
    cmdl
        .command('help')
        .description('Help [command]')
        .action(function(cmd){
            if (cmd === 'user'){
                //showUsageUser();
            } else {
                //app.log('Command <' + cmd + '> is not recognized.');
            }
            process.exit(0);
        });
    cmdl
        .command('user')
        .description('Manage users')
        .action(function(subcommand,data){
            if (arguments.length === 1) {
                //showUsageUser();
                process.exit(1);
            }

            if (subcommand === 'help'){
                //showUsageUser(data);
                process.exit(1);
            }

            if (data === 'help'){
                //showUsageUser(subcommand);
                process.exit(1);
            }

            data.controller = NewUserController;
        });
    cmdl
        .parse(process.argv);


    return q(data);
}

////////////////////////////////////////////////////////////
//  

function c6Api(opts){
    var deferred = q.defer();
  
    opts.uri = 'http://staging.cinema6.com' + opts.uri;
    request(opts,function(error, response, body){
        if (error){
            deferred.reject(error);
            return;
        }

        if ((response.statusCode < 200) || (response.statusCode >= 300)){
            deferred.reject({
                statusCode : response.statusCode,
                response   : response.body
            });
            return;
        }

        deferred.resolve(body);
    });
    

    return deferred.promise;
};

c6Api.login = function(params){
    var opts  = {
            method  : 'POST',
            uri     : '/api/auth/login',
            jar     : true,
            json : {
                email   : params.email,
                password: params.password
            }
        };
    return this(opts); 
};

c6Api.createUser = function(params){
    var opts  = {
            method : 'POST',
            uri     : '/api/account/user',
            jar     : true,
            json : {
                email   : params.email,
                password: params.password,
                org     : params.orgId
            }
        };
  
    return this(opts);
};

////////////////////////////////////////////////////////////
// NewUserModel

function NewUserModel () {
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
        set : function(v){ _password2 = validatePassword(v,_password); },
        get : function() { return _password2; } 
    });
    
    Object.defineProperty(this,'orgId',{
        enumerable: true,
        set : function(v){ _orgId = v; },
        get : function() { return _orgId; } 
    });
}

////////////////////////////////////////////////////////////
// NewUserView

function NewUserView() {
    this.presentView = function(){
        console.log('Create new user:');
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

////////////////////////////////////////////////////////////
// NewUserController

function NewUserController(api){
    var self = this;

    self.onData = function(key,val){
        self.model[key] = val;
    };

    self.run = function(){
        return self.showView()
            .then(function(){
                return api.createUser(self.model)
                    .then(function(response){
                        console.log('Created new user: ' + self.model.email);
                        console.log(response);
                    });
            });
    };
}

NewUserController.$view  = MVC.CmdlView.Subclass(NewUserView);
NewUserController.$model = NewUserModel;
NewUserController.$deps  = ['c6Api'];
////////////////////////////////////////////////////////////
// Login

// Model
//
function LoginModel() {
    this.email       = null;
    this.password    = null;
}

// View
//
function LoginView() {
    this.presentView = function(){
        console.log('');
        console.log('Login to server:');
        var self = this;
        return self.doPrompt('email' )
        .then(function(){
            return self.doPrompt('password')
        })
    };
}

// Controller
//
function LoginController(api) {
    var self = this;
    self.initWithData = function(initData){
        self.model.email    = initData.email;
        self.model.password = initData.password;
    };

    self.onData = function( key, value){
        self.model[key] = value;
    };

    self.run = function(){
        return q(function(){
            if (self.model.email && self.model.password){
                return q.when({});
            }
            return self.showView();
        }())
        .then(function(){
            return api.login(self.model)
                .then(function(){
                    console.log('Logged in as ' + self.model.email);
                    return true;
                });
        });
    };
}

LoginController.$model = LoginModel;
LoginController.$view  = MVC.CmdlView.Subclass(LoginView);
LoginController.$deps  = ['c6Api'];

////////////////////////////////////////////////////////////

MVC.registerDependency('c6Api',c6Api);

var loginCtrl   = MVC.createController(LoginController);

parseCmdLine()
.then(function(config){
    app.data = config;
    return loginCtrl.run();
})
.then(function(){
    return MVC.createController(app.data.controller).run();
})
.then(function(){
    process.exit(0);
})
.catch(function(err){
    console.log(err);
    process.exit(1);
});
