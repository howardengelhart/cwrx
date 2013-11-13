describe('formatter',function(){
    var formatter;
    beforeEach(function() {
        formatter = require('../../lib/format');
    });
    
    it('should exist', function(){
        expect(formatter).toBeDefined('formatter');
    });

    describe('basic', function(){
        it('should create a format function with context', function(){
            var fmt = formatter('someFunction');
            expect(fmt('this is a test')).toEqual('{someFunction} this is a test');
        });
        
        it('should create a format function with no context', function(){
            var fmt = formatter();
            expect(fmt('this is a test')).toEqual('this is a test');
        });
    });

    describe('interpolation',function(){
        var fmt;
        beforeEach(function(){
            fmt = formatter('myFunc');
        });

        it('should handle a single variable', function(){
            expect(fmt('this %1 a test','is')).toEqual('{myFunc} this is a test');
        });

        it('should handle a variable at the start', function(){
            expect(fmt('%1 is a test','this')).toEqual('{myFunc} this is a test');
        });

        it('should handle a variable at the end', function(){
            expect(fmt('this is a %1','test')).toEqual('{myFunc} this is a test');
        });

        it('should handle a percent at the end', function(){
            expect(fmt('this is a %','test')).toEqual('{myFunc} this is a %');
        });

        it('should handle a percent in the middle', function(){
            expect(fmt('this is a % test','test')).toEqual('{myFunc} this is a % test');
        });

        it('should handle a double percent in the middle', function(){
            expect(fmt('this is a %%1 test','3')).toEqual('{myFunc} this is a %3 test');
        });

        it('should handle a variable with 0', function(){
            expect(fmt('this %1 test',0)).toEqual('{myFunc} this 0 test');
        });

        it('should handle a variable with null', function(){
            expect(fmt('this %1 test',null)).toEqual('{myFunc} this null test');
        });

        it('should handle multiple variables',function(){
            expect(fmt('this %1 %2 test','is','a')).toEqual('{myFunc} this is a test');
        });
        
        it('should handle repeat variables',function(){
            expect(fmt('this %1 %1 test','is','a')).toEqual('{myFunc} this is is test');
        });

        it('should handle out of range variables',function(){
            expect(fmt('this %2 a test','is'))
                .toEqual('{myFunc} this undefined a test');
            expect(fmt('this %0 a test','is'))
                .toEqual('{myFunc} this undefined a test');
        });
        
        it('should handle no context',function(){
            var fmt = formatter();
            expect(fmt('this %1 a test','is')).toEqual('this is a test');
        });
/*
        it('should be quick', function(){
            function fmtString(){
                var fmt = formatter('myFunc');
                expect(fmt('the %1 %2 %3 went to %4', 'quick','brown','fox','school'))
                    .toEqual('{myFunc} the quick brown fox went to school');
            }

            function concatString(){
                expect('{myFunc} ' + 'the ' + 'quick' + ' ' + 'brown' + ' '  + 'fox' +
                    ' went to' + ' school')
                    .toEqual('{myFunc} the quick brown fox went to school');
            }

            var resultsConcat = [], resultsFormat = [], sets = 1000, reps = 10,
                v = 0, avgConcat = 0, avgFormat =0,
                minConcat =0, minFormat =0, maxFormat = 0, maxConcat = 0;
            for (var j = 0; j < sets; j++){
                var dtStart = new Date();
                for (var i = 0; i < reps; i++){
                    fmtString();
                }
                v = (new Date()).valueOf() - dtStart.valueOf();
                avgFormat += v;
                resultsFormat.push(v);

                for (i = 0; i < reps; i++){
                    concatString();
                }
                v = (new Date()).valueOf() - dtStart.valueOf();
                avgConcat += v;
                resultsConcat.push(v);
            }

            var fmt = formatter();
//                    console.log(fmt('Sets: %1, Reps: %2',sets,reps));
            avgConcat /= sets;
            maxConcat = Math.max.apply(null,resultsConcat);
            minConcat = Math.min.apply(null,resultsConcat);
//                    console.log(fmt('Concat: Min=%1, Max=%2 Avg=%3',
//                        minConcat,maxConcat, avgConcat));

            avgFormat /= sets;
            minFormat = Math.min.apply(null,resultsFormat);
            maxFormat = Math.max.apply(null,resultsFormat);
//                    console.log(fmt('Format: Min=%1, Max=%2 Avg=%3',
//                        minFormat,maxFormat, avgFormat));

            expect(maxFormat).toBeLessThan(200);

        });
*/
    });
});

