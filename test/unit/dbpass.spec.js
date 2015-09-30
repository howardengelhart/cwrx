describe('dbpass unit tests',function(){
    var flush = true, fs, os, pgpass, mockData;
    beforeEach(function(){
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        fs      = require('fs');
        os      = require('os');
        dbpass  = require('../../lib/dbpass');
        spyOn(fs,'statSync');
        spyOn(fs,'readFileSync');

        mockData = [
                '#my big',
                'mybig.org:*:db1:joe:Password1',
                '',
                '#my other big',
                'mybig.org:*:*:joe:Password2',
                '',
                'testMongo:27017:utDb:johnny:testmonkey',
                '*:*:*:*:freakazoid',
            ];
    });

    describe('dbpass.open',function(){
        beforeEach(function(){
            process.env.HOME = '/test/home';
            fs.statSync.and.returnValue({ mode : parseInt(100600,8) });
            fs.readFileSync.and.returnValue(mockData.join(os.EOL));
        });

        describe('parsing',function(){
        
            it('will use $HOME/.pgpass by default.',function(){
                dbpass.open();
                expect(fs.statSync).toHaveBeenCalledWith('/test/home/.pgpass');
                expect(fs.readFileSync).toHaveBeenCalledWith('/test/home/.pgpass');
            });

            it('will use path if provided.',function(){
                dbpass.open('myfile');
                expect(fs.statSync).toHaveBeenCalledWith('myfile');
                expect(fs.readFileSync).toHaveBeenCalledWith('myfile');
            });

            it('will throw an exception if the file data is undefined.',function(){
                fs.readFileSync.and.returnValue(undefined);
                expect(function(){
                    dbpass.open();
                }).toThrow(new Error('Password file content cannot be parsed.'));
            });

            it('will throw an exception if the file data is empty.',function(){
                fs.readFileSync.and.returnValue('');
                expect(function(){
                    dbpass.open();
                }).toThrow(new Error('Password file has no content.'));
            });

            it('will throw an exception if the file data is invalid.',function(){
                fs.readFileSync.and.returnValue('abc:def:ghi');
                expect(function(){
                    dbpass.open();
                }).toThrow(new Error('dbpass parse error: bad field count.'));
            });

            it('will throw an exception if the file has no valid data.',function(){
                fs.readFileSync.and.returnValue('#this is a comment');
                expect(function(){
                    dbpass.open();
                }).toThrow(new Error('dbpass parse error: no data found.'));
            });

            it('will throw an exception if the file is not 400 or 600',function(){
                fs.statSync.and.returnValue({ mode : parseInt(100644,8) });
                expect(function(){
                    dbpass.open();
                }).toThrow(new Error('Password file is not adequately secured.'));
            });

            it('will return a passfinder if the file is parsed', function(){
               expect(dbpass.open().data).toEqual([
                {hostname:'mybig.org',port:'*',database:'db1',username:'joe',password:'Password1'},
                {hostname:'mybig.org',port:'*',database:'*',username:'joe',password:'Password2'},
                {hostname:'testMongo',port:'27017',database:'utDb',username:'johnny',password:'testmonkey'},
                {hostname:'*',port:'*',database:'*',username:'*',password:'freakazoid'}
               ]); 
            });
        });

        describe('lookup function',function(){
            var lookup;
            
            beforeEach(function(){
                lookup = dbpass.open();
            });

            it('lookup() returns freakazoid',function(){
                expect(lookup()).toEqual('freakazoid');
            });
            
            it('lookup(h) returns freakazoid',function(){
                expect(lookup('h')).toEqual('freakazoid');
            });
            
            it('lookup(null,null,d,u) returns freakazoid',function(){
                expect(lookup(null,null,'d','u')).toEqual('freakazoid');
            });
            
            it('lookup(mybig.org,undefined,testDb,mary) returns freakazoid',function(){
                expect(lookup('mybig.org',undefined,'testDb','mary')).toEqual('freakazoid');
            });
            
            it('lookup(mybig.org,undefined,testDb,joe) returns Password2',function(){
                expect(lookup('mybig.org',undefined,'testDb','joe')).toEqual('Password2');
            });
            
            it('lookup(mybig.org,undefined,db1,joe) returns Password1',function(){
                expect(lookup('mybig.org',undefined,'db1','joe')).toEqual('Password1');
            });
            
            it('lookup(testMongo,27017,utDb,johnny) return testmonkey', function() {
                expect(lookup('testMongo', 27017, 'utDb', 'johnny')).toEqual('testmonkey');
            });
        });
    });
});
