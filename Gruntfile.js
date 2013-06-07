var fs   = require('fs-extra'),
    path = require('path');

module.exports = function (grunt) {

    //var packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'))),
    var initProps = {
            prefix      : process.env['HOME'],
            packageInfo : grunt.file.readJSON('package.json')
        };
        initProps.installDir  = initProps.packageInfo.name + '_' + initProps.packageInfo.version;
        initProps.installPath = path.join(initProps.prefix, 'releases', initProps.installDir);
        initProps.servicePath = path.join(initProps.prefix, 'services' );

    grunt.initConfig({
        props   : initProps,

        copy    : {
            prod : { 
                files:  [
                            { 
                                expand: true, 
                                dest: '<%= props.installPath %>', 
                                src: [ 'bin/*', 'lib/*', 'config/*', 'node_modules/**', 'package.json' ] 
                            }
                        ]
               }
        },

        link : {
                options : {
                    overwrite: true,
                    force    : true,
                    mode     : '755'
                },
                service : {
                    target : '<%= props.installPath %>',
                    link   : path.join('<%= props.servicePath %>','<%= props.packageInfo.name %>')
                },
                dub : {
                    target : path.join('<%= props.installPath %>','bin','dub.js'),
                    link   : path.join('<%= props.installPath %>','bin','dub')
                },
                dubcli : {
                    target : path.join('<%= props.installPath %>','bin','dubcli.js'),
                    link   : path.join('<%= props.installPath %>','bin','dubcli')
                }
        },

        rmbuild : {
            history : 2 
        }
    });
    
    grunt.loadNpmTasks('grunt-contrib-copy');

    grunt.registerTask('rmbuild','Remove old copies of the install',function(){
        var installBase = grunt.config.get('props.packageInfo.name'),
            installPath = grunt.config.get('props.installPath'),
            installRoot = path.dirname(installPath),
            pattPart = new RegExp(installBase +  '_(\\d+)\\.(\\d+)\\.(\\d+)'),
            pattFull = new RegExp(installBase +  '_\\d+\\.\\d+\\.\\d+\\.(\\d{8})T(\\d{9})Z'),
            history     = grunt.config.get('rmbuild.history'), 
            contents = [];
       
        if (history === undefined){
            history = 2;
        }
        grunt.log.writelns('Max history: ' + history);

        fs.readdirSync(installRoot).forEach(function(dir){
            if (pattPart.test(dir)){
                contents.push(dir);
            }
        });
        
        if (contents){
            var sorted = contents.sort(function(A,B){
              var  mA = pattPart.exec(A),
                   mB = pattPart.exec(B);
               for (var i = 1; i <= 3; i++){
                   if (mA[i] != mB[i]){
                        return mA[i] - mB[i];
                   }
               }
               // The version is the same
               mA = pattFull.exec(A);
               mB = pattFull.exec(B);
               if (mA === null) { return 1; }
               if (mB === null) { return -1; }
               for (var i = 1; i <= 2; i++){
                   if (mA[i] != mB[i]){
                        return mA[i] - mB[i];
                   }
                }
               return 1; 
            });
            while (sorted.length > history){
                var dir = sorted.shift();
                grunt.log.writelns('remove: ' + dir);
                fs.removeSync(path.join(installRoot,dir));
            }
        }
    });

    grunt.registerTask('mvbuild', 'Move the build to a release folder.', function(){
        if (grunt.config.get('moved')){
            grunt.log.writeln('Already moved!');
            return;
        }
        var installPath = grunt.config.get('props.installPath');
        grunt.log.writeln('Moving the module to ' + installPath);
        
        if (fs.existsSync(installPath)){
            grunt.log.errorlns('Install dir (' + installPath + 
                                ') already exists, rotate.');
           
            var stat = fs.statSync(installPath),
                tag = stat.ctime.toISOString().replace(/\W/g,''); 

            fs.renameSync(installPath,installPath + '.' + tag);
        }

        grunt.task.run('copy:prod');
        grunt.config.set('moved',true);
    });

    grunt.registerMultiTask('link', 'Link release apps.', function(){
        var opts = grunt.config.get('link.options'),
            data = this.data;

        if (!data.options){
            data.options = {};
        }

        if (!data.options.mode){
            data.options.mode = '0755';
        }
    
        if (opts){
           Object.keys(opts).forEach(function(opt){
                if (data.options[opt] === undefined){
                    data.options[opt] = opts[opt];
                }
           });
        }

        if (data.options.overwrite === true){
            if (fs.existsSync(data.link)){
                grunt.log.writelns('Removing old link: ' + data.link);
                fs.unlink(data.link);
            }
        }

        if (data.options.force){
            var linkDir = path.dirname(data.link);        
            if (!fs.existsSync(linkDir)){
                grunt.log.writelns('Creating linkDir: ' + linkDir);
                grunt.file.mkdir(linkDir, '0755');
            }
        }

        grunt.log.writelns('Create link: ' + data.link + ' ==> ' + data.target);
        fs.symlinkSync(data.target, data.link);

        grunt.log.writelns('Make link executable.');
        fs.chmodSync(data.link,data.options.mode);
        
        grunt.log.writelns(data.link + ' is ready.');
    });

    grunt.registerTask('install', 'Install', function(){
        grunt.task.run('mvbuild');
        grunt.task.run('link');
    });
};

