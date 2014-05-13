
var request = require('request'),
    util    = require('util'),
    path    = require('path'),
    q       = require('q'),
    fs      = require('fs-extra'),
    cmdl    = require('commander'),
    uuid    = require('./lib/uuid'),
    MVC     = require('./lib/mvc');

log = function(){
    var args = Array.prototype.slice.call(arguments, 0);
    args.push('\n');
    process.stdout.write(args.join(' '));
};

parseCmdLine = function(cfg){
    var cmdl = require('commander'),
        provData, authFile = path.join(process.env.HOME,'.c6prov.json');

    if (!cfg){
        cfg = {};
    }

    if (fs.existsSync(authFile)){
        try {
            provData = fs.readJsonSync(authFile);
            cfg.email    = provData.email;
            cfg.password = provData.password;
            cfg.server   = provData.server;
        }catch(e){
            log('Unable to read ' +  authFile);
        }
    }
    
    function showUsageUser(sub){
        log('');
        log('Usage:');
        log(' provision user');
        log('');
        if (sub === 'create'){

        } else {
            log(' Users associated api tasks.  Current list includes:');
            log('   * create');
            log('');
            log(' user help <task> will provide additional detail.');
            log('');
        }

        log('Example:');
        log('');
        log(' #Create a user');
        log(' $ node bin/provision.js user create');
        log('');
    }
    
    cmdl
        .option('-e, --email [email]','Logon.')
        .option('-s, --server [URL]','API Host.', cfg.server || 'https://staging.cinema6.com')
    cmdl
        .command('help')
        .description('Help [command]')
        .action(function(cmd){
            if (cmd === 'user'){
                showUsageUser();
            } else {
                log('Command <' + cmd + '> is not recognized.');
            }
            process.exit(0);
        });
    cmdl
        .command('user')
        .description('Manage users')
        .action(function(subcommand,data){
            if (arguments.length === 1) {
                showUsageUser();
                process.exit(1);
            }

            if (subcommand === 'help'){
                showUsageUser(data);
                process.exit(1);
            }

            if (data === 'help'){
                showUsageUser(subcommand);
                process.exit(1);
            }

            if (subcommand === 'create')  { 
                cfg.controller = NewUserController;
            }
        });
    cmdl
        .parse(process.argv);

    if (!cfg.controller){
        log('Need a command!');
        process.exit(1);
    }

    if (cmdl.email){
        cfg.email = cmdl.email;
    }

    if (cmdl.server) {
        cfg.server = cmdl.server;
    }

    return q(cfg);
}

////////////////////////////////////////////////////////////
//  

function c6Api(opts){
    var deferred = q.defer();
 
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
            uri     : c6Api.server + '/api/auth/login',
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
            uri     : c6Api.server + '/api/account/user',
            jar     : true,
            json : {
                email    : params.email,
                password : params.password,
                org      : params.orgId
            }
        };
    if (params.branding){
        opts.json.branding = params.branding;
    }
    
    return this(opts);
};


////////////////////////////////////////////////////////////
// NewUserModel

function NewUserModel () {
    _email     = null;
    _password  = null;
    _password2 = null;
    _orgId     = null;
    _branding  = null;

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
    
    Object.defineProperty(this,'branding',{
        enumerable: true,
        set : function(v){ _branding = v; },
        get : function() { return _branding; } 
    });
}

////////////////////////////////////////////////////////////
// NewUserController

function NewUserController(api,cfg){
    var self = this;

    self.initView(
        'Create User',
        [
            {
                label : 'email',
                repeat: 1
            },
            {
                label : 'password',
                repeat: 1
            },
            {
                label : 'confirm password',
                alias : 'password2',
                repeat: 1
            },
            {
                label : 'organization',
                alias : 'orgId',
                defaultVal : 'o-' + uuid.createUuid().substr(0,14)
            },
            {
                label : 'branding'
            }
        ],
        self.model
    );

    self.run = function(){
        return self.showView()
            .then(function(){
                return api.createUser(self.model)
                    .then(function(response){
                        self.view.alert('');
                        self.view.alert('Created new user: ' + self.model.email);
                        self.view.alert('');
                        self.view.alert(JSON.stringify(response,null,3));
                        self.view.alert('');
                    });
            });
    };
}

NewUserController.$view  = MVC.CmdlView;
NewUserController.$model = NewUserModel;
NewUserController.$deps  = ['c6Api','config'];
////////////////////////////////////////////////////////////
// Login

// Model
//
function LoginModel() {
    this.email       = null;
    this.password    = null;
}

// Controller
//
function LoginController(api,cfg) {
    var self = this, prompts = [];
    
    self.model.email    = cfg.email;
    self.model.password = cfg.password;

    if (!self.model.email){
        prompts.push({
            label : 'email',
            binding: self.model
        });
    }

    if (!self.model.password){
        prompts.push({
            label : 'password',
            binding: self.model
        });
    }

    self.initView('Logon to ' + cfg.server,  prompts );
    
    self.run = function(){
        return self.showView()
        .then(function(){
            return api.login(self.model)
                .then(function(){
                    self.view.alert('');
                    self.view.alert('Logged in to ' + api.server + ' as ' + self.model.email);
                    self.view.alert('');
                    return true;
                });
        });
    };
}

LoginController.$model = LoginModel;
LoginController.$view  = MVC.CmdlView;
LoginController.$deps  = ['c6Api','config'];

////////////////////////////////////////////////////////////

parseCmdLine()
.then(function(cfg){
    MVC.registerDependency('config',cfg);
    MVC.registerDependency('c6Api',c6Api);
    c6Api.server = cfg.server;
    return MVC.launchController(LoginController).then(function(){ return cfg; });
})
.then(function(cfg){
    return MVC.launchController(cfg.controller);
})
.then(function(){
    process.exit(0);
})
.catch(function(err){
    log('');
    log('There was an error:');
    log('');
    if (err.message) {
        log(err.message);
    } else {
        log(JSON.stringify(err,null,3));
    }
    log('');
    process.exit(1);
});
