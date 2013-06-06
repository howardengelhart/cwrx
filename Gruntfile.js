var fs = require('fs'),
    path = require('path');

module.exports = function (grunt) {

    //var packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'))),
    var packageInfo = grunt.file.readJSON('package.json'),
        initProps = {
            msg         : 'this is a test!',
            prefix      : process.env['HOME'],
            packageInfo : packageInfo
        };
        initProps.installDir  = initProps.packageInfo.name + initProps.packageInfo.version;
        initProps.installPath = path.join(initProps.prefix, 'builds', initProps.installDir);
        initProps.servicePath = path.join(initProps.prefix, 'services' );

    grunt.initConfig({
        props   : initProps,

        copy    : {
            prod : { 
                files:  [
                            { 
                                expand: true, 
                                dest: '<%= props.installPath %>', 
                                src: [ 'bin/*', 'lib/*', 'node_modules/**', 'package.json' ] 
                            }
                        ]
               }


        },

        symlink : {
            dub : {
                target : path.join('<%= props.installPath %>','bin','dub.js'),
                link   : path.join('<%= props.servicePath %>','dub'),
                options : {
                    overwrite: true,
                    force    : true
                }
            }
        },

        chmod   : {
            dub: {
                options : {
                    mode : '555'
                 },
                src : [ path.join('<%= props.servicePath %>','dub') ]
            }
        },

        link : {
                options : {
                    overwrite: true,
                    force    : true,
                    mode     : '555'
                },
                dub : {
                    target : path.join('<%= props.installPath %>','bin','dub.js'),
                    link   : path.join('<%= props.servicePath %>','dub')
                },
                dubcli : {
                    target : path.join('<%= props.installPath %>','bin','dubcli.js'),
                    link   : path.join('<%= props.servicePath %>','dubcli')
                }
        },

        install : {
            dub : true,
            dubcli : true   
        }
    });
    
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-symbolic-link');
    grunt.loadNpmTasks('grunt-chmod');

    grunt.registerTask('deploy', 'Deploy the release.', function(){
        if (grunt.config.get('deployed')){
            return;
        }
        var installPath = grunt.config.get('props.installPath');
        grunt.log.writeln('Deploying the module to ' + installPath);
        
        if (fs.existsSync(installPath)){
            grunt.log.errorlns('Install dir (' + installPath + 
                                ') already exists, rotate.');
           
            var stat = fs.statSync(installPath),
                tag = stat.ctime.toISOString().replace(/\W/g,''); 

            fs.renameSync(installPath,installPath + '.' + tag);
        }

        grunt.task.run('copy:prod');
        grunt.config.set('deployed',true);
    });

    grunt.registerMultiTask('link', 'Link release apps.', function(){
        var opts = grunt.config.get('link.options'),
            data = this.data;
        if (!data.options){
            data.options = {};
        }

        if (!data.options.mode){
            data.options.mode = '555';
        }
    
        if (opts){
           Object.keys(opts).forEach(function(opt){
                if (data.options[opt] === undefined){
                    data.options[opt] = opts[opt];
                }
           });
        }

        if (fs.existsSync(data.link)){
            if (data.options.overwrite === true){
                fs.unlink(data.link);
            }
        }
        fs.symlinkSync(data.target, data.link);

        fs.chmodSync(data.link,data.options.mode);
    });

    grunt.registerMultiTask('install', 'Install', function(){
        grunt.task.run('deploy');
        grunt.task.run('link:' + this.target);
    });
};

