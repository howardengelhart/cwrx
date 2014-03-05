module.exports = {
    test: {
        options: {
            debounceDelay : 10000,
            atBegin : true
        },
        files: [
            'bin/**/*.js',
            'lib/**/*.js',
            'test/**/*.js' 
        ],
        tasks: ['jshint', 'unit_tests' ]
    }
};
