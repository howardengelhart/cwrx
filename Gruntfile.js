module.exports = function (grunt) {

    initProps = {
        msg     :   'this is a test!',
        prefix  : process.env['HOME']
    };
  
    grunt.initConfig({
        props : initProps
    });
    
    grunt.registerTask('install', 'Install the release.', function(){
        grunt.log.writeln('Installing the module to ' + 
            grunt.config.get('props.prefix') );
    });

};

