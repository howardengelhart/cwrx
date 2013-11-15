describe('inject',function(){
    var module;

    beforeEach(function(){
        module = require('../../lib/inject');
    });

    describe('injector',function(){
        var injector;
        beforeEach(function(){
            injector = module.createInjector();
        });
        
        it('should exist',function(){
            expect(injector).toBeDefined();
        });

        it('should be initialized with an empty dependency cache',function(){
            expect(injector.privateData).toEqual({});
        });
        
        it('should isolate its data',function(){
            injector.privateData['test'] = 5;
            var injector2 = module.createInjector();
            expect(injector.privateData).toEqual({ 'test' : 5});
            expect(injector2.privateData).toEqual({});
        });


        describe('configure method',function(){
            it('should return a reference to the injector',function(){
                expect(injector.configure('data',{ val : 1 })).toBe(injector);
            });

            it('should store a dependency by alias',function(){
                injector.configure('test',{ val : 'case' });
                expect(injector.privateData.test).toEqual( { val : 'case' } );
            });

            it('should store a dependency with a path for an alias',function(){
                injector.configure('../test/dep',{ val : 'case' });
                expect(injector.privateData['../test/dep']).toEqual( { val : 'case' } );
            });

            it('should except if overwriting an dependency with a new value',function(){
                injector.configure('testa',1);
                expect(function(){
                    injector.configure('testa',2);
                }).toThrow('Cannot overwrite dependency \'testa\'');
            });

            it('should not except if overwriting dependency with same value',function(){
                injector.configure('testa',1);
                expect(function(){
                    injector.configure('testa',1);
                }).not.toThrow();
            });

            it('should not except if overwriting dependency with new value and override is set to true',function(){
                injector.configure('testa',1);
                expect(function(){
                    injector.configure('testa',2,true);
                }).not.toThrow();
            });
        });

        describe('inject method', function(){
            it('should throw an exception if a dependency does not exist',function(){
                expect(function(){ 
                    injector.inject('test')
                }).toThrow('Unable to locate dependency: \'test\'');
            });

            it('should return a dependency if it has it',function(){
                injector.privateData['test'] = 5;
                expect(injector.inject('test')).toEqual(5);
            });
        });

        describe('require method', function(){
            var requireSpy;
            beforeEach(function(){
                requireSpy = jasmine.createSpy('require');
                module.reset(requireSpy); 
            });

            it('should return a dependency if it is in the cache',function(){
                injector.privateData['test'] = 5;
                expect(injector.require('test')).toEqual(5);
            });

            it('should require a dependency if it is not in the cache',function(){
                injector.require('test/module');
                expect(requireSpy).toHaveBeenCalledWith('test/module');
            });
        });
    });

    describe('module',function(){
        var defaultInjector;

        beforeEach(function(){
            defaultInjector = module.reset(); 
        });

        it('uses a default injector',function(){
            expect(defaultInjector).toBeDefined();
        });

        describe('configure method',function(){
            it('returns a references to the module',function(){
                expect(module.configure('test',5)).toBe(module);
            });

            it('uses the defaultInjector',function(){
                module.configure('test',5);
                expect(defaultInjector.privateData['test']).toEqual(5);
            });

            it('does not interfere with other injectors',function(){
                var injector = module.createInjector();
                injector.privateData['test'] = 9;
                module.configure('else',4);
                expect(injector.privateData).toEqual({'test':9});
            });
        });

        describe('inject method',function(){
            it('should throw an exception if a dependency does not exist',function(){
                expect(function(){ 
                    module.inject('test')
                }).toThrow('Unable to locate dependency: \'test\'');
            });

            it('should return a dependency if it has it',function(){
                defaultInjector.privateData['test'] = 5;
                expect(module.inject('test')).toEqual(5);
            });
        });

        describe('require method', function(){
            var requireSpy;
            beforeEach(function(){
                requireSpy = jasmine.createSpy('require');
                defaultInjector = module.reset(requireSpy); 
            });

            it('should return a dependency if it is in the cache',function(){
                defaultInjector.privateData['test'] = 5;
                expect(module.require('test')).toEqual(5);
            });

            it('should require a dependency if it is not in the cache',function(){
                module.require('test/module');
                expect(requireSpy).toHaveBeenCalledWith('test/module');
            });
        });
    });
});



