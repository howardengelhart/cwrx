var path    = require('path'),
    fs      = require('fs-extra');

module.exports = function(grunt) {
    grunt.registerTask('install_hook','Installs pre-commit hook', function(){
        var hookPath = path.join(__dirname,'../.git/hooks/pre-commit'), hookFile, done;
        
        if (fs.existsSync(hookPath)){
            grunt.log.errorlns('WARNING: will not overwrite existing pre-commit hook');
            return true;
        }
        done = this.async();
        hookFile =  '# Installed by grunt install_hook\n\n'
        hookFile += 'grunt jshint\n';
        hookFile += 'grunt unit_tests\n';
        
        fs.outputFileSync(hookPath,hookFile);
        grunt.util.spawn({
            cmd : 'chmod',
            args : ['755',hookPath]
        }, function(error,result,code) {
            grunt.log.writeln(result.stdout);
            if (error) {
                grunt.log.errorlns('failed to change mode: ' + error);
                done(false);
                return;
            }
            done(true);
        });
    });
};
