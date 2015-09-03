var flush = true;
describe('Model', function() {
    var q, mockLog, logger, Model;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        Model           = require('../../lib/model');
        q               = require('q');
        logger          = require('../../lib/logger');

        mockLog = {
            trace : jasmine.createSpy('log.trace'),
            error : jasmine.createSpy('log.error'),
            warn  : jasmine.createSpy('log.warn'),
            info  : jasmine.createSpy('log.info'),
            fatal : jasmine.createSpy('log.fatal'),
            log   : jasmine.createSpy('log.log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
    });

    describe('initialization', function() {
        it('should store the objName and schema internally', function() {
            var schema = { tails: 'yes', paws: 'yes', meow: 'no' },
                testModel = new Model('puppies', schema);
            expect(testModel.objName).toBe('puppies');
            expect(testModel.schema).toBe(schema);
            expect(testModel.schema).toEqual({ tails: 'yes', paws: 'yes', meow: 'no' });
        });
    });
    
    describe('personalizeSchema', function() {
        var model, requester;
        beforeEach(function() {
            model = new Model('puppies', {
                id: {
                    __type: 'string', __allowed: false, __locked: true
                },
                born: {
                    __type: 'Date', __allowed: false
                },
                name: {
                    __type: 'string', __allowed: false
                },
                paws: {
                    __type: 'number', __allowed: true, __min: 2
                },
                snax: {
                    kibbles: {
                        __type: 'string', __allowed: true, __acceptableValues: ['yes', 'no']
                    },
                    bacon: {
                        __type: 'string', __allowed: true, __acceptableValues: '*'
                    },
                }
            });
            requester = {
                id: 'u-1',
                fieldValidation: {
                    kitties: { name: { __required: true } },
                    puppies: {
                        name: {
                            __allowed: true
                        },
                        snax: {
                            kibbles: {
                                __acceptableValues: ['very yes']
                            }
                        }
                    }
                }
            };
        });
        
        it('should just return a copy of the default schema if the user has no fieldValidation for these objects', function() {
            delete requester.fieldValidation.puppies;
            var personalized = model.personalizeSchema(requester);
            expect(personalized).toEqual(model.schema);
            expect(personalized).not.toBe(model.schema);
        });
        
        it('should merge the requester\'s fieldValidation with the default schema', function() {
            var personalized = model.personalizeSchema(requester);
            expect(personalized).not.toEqual(model.schema);
            expect(personalized).toEqual({
                id: {
                    __type: 'string', __allowed: false, __locked: true
                },
                born: {
                    __type: 'Date', __allowed: false
                },
                name: {
                    __type: 'string', __allowed: true
                },
                paws: {
                    __type: 'number', __allowed: true, __min: 2
                },
                snax: {
                    kibbles: {
                        __type: 'string', __allowed: true, __acceptableValues: ['very yes']
                    },
                    bacon: {
                        __type: 'string', __allowed: true, __acceptableValues: '*'
                    },
                }
            });
        });
        
        it('should not be able to overwrite __locked fields on the default schema', function() {
            requester.fieldValidation.puppies.id = { __allowed: true, __min: 10 };
            var personalized = model.personalizeSchema(requester);
            expect(personalized).not.toEqual(model.schema);
            expect(personalized.id).toEqual({
                __type: 'string', __allowed: false, __locked: true
            });
        });
        
        it('should not be able to overwrite __type settings on the default schema', function() {
            requester.fieldValidation.puppies.name = {
                __type: 'object', __allowed: true,
            };
            var personalized = model.personalizeSchema(requester);
            expect(personalized).not.toEqual(model.schema);
            expect(personalized.name).toEqual({
                __type: 'string', __allowed: true
            });
        });
        
        it('should not screw up dates', function() {
            var now = new Date(),
                later = new Date(now + 1000);
            model.schema.born.__default = now;
            requester.fieldValidation.puppies.born = { __default: later };
            
            var personalized = model.personalizeSchema(requester);
            expect(personalized.born).toEqual({
                __type: 'Date', __allowed: false, __default: later
            });
        });
        
        it('should allow the requester\'s fieldValidation to define configs for new fields', function() {
            requester.fieldValidation.puppies.likesCats = {
                __type: 'boolean', __allowed: true
            };
            
            var personalized = model.personalizeSchema(requester);
            expect(personalized.likesCats).toEqual({
                __type: 'boolean', __allowed: true
            });
        });
    });
    
    describe('checkFormat', function() {
        it('should handle simple type strings', function() {
            expect(Model.checkFormat('string', 1)).toBe(false);
            expect(Model.checkFormat('string', '1')).toBe(true);
            expect(Model.checkFormat('object', 'a')).toBe(false);
            expect(Model.checkFormat('object', { foo: 'bar' })).toBe(true);
            expect(Model.checkFormat('object', [1, 2, '3'])).toBe(false);
            expect(Model.checkFormat('number', 1)).toBe(true);
            expect(Model.checkFormat('number', '1')).toBe(false);
            expect(Model.checkFormat('boolean', true)).toBe(true);
            expect(Model.checkFormat('boolean', false)).toBe(true);
            expect(Model.checkFormat('boolean', 1)).toBe(false);
            expect(mockLog.warn).not.toHaveBeenCalled();
        });
        
        it('should handle Dates', function() {
            expect(Model.checkFormat('Date', 'a')).toBe(false);
            expect(Model.checkFormat('Date', new Date())).toBe(true);
            expect(Model.checkFormat('Date', new Date().toISOString())).toBe(false);
            expect(mockLog.warn).not.toHaveBeenCalled();
        });
        
        it('should handle array formats', function() {
            expect(Model.checkFormat('stringArray', '[a,b]')).toBe(false);
            expect(Model.checkFormat('stringArray', ['a', 'b'])).toBe(true);
            expect(Model.checkFormat('stringArray', ['a', 1])).toBe(false);
            expect(Model.checkFormat('DateArray', [new Date(), new Date(new Date() - 1000)])).toBe(true);
            expect(Model.checkFormat('DateArray', [new Date(), new Date().toISOString()])).toBe(false);
        });
        
        it('should log a warning if the format is invalid', function() {
            expect(Model.checkFormat({foo: 'bar'}, 'asdf')).toBe(true);
            expect(mockLog.warn).toHaveBeenCalled();
            expect(Model.checkFormat('poopArray', ['asdf'])).toBe(true);
            expect(mockLog.warn.calls.length).toBe(2);
        });
    });
    
    describe('checkLimits', function() {
        it('should return isValid = true if the config is missing or contains no limit fields', function() {
            expect(Model.checkLimits(null, 'fido', 'name')).toEqual({ isValid: true });
            expect(Model.checkLimits({ __type: 'object' }, 'fido', 'name')).toEqual({ isValid: true });
        });
        
        it('should be able to check that a value passes a min threshold', function() {
            expect(Model.checkLimits({ __min: 2 }, 4, 'paws')).toEqual({ isValid: true });
            expect(Model.checkLimits({ __min: 2 }, 1, 'paws')).toEqual({ isValid: false,
                reason: 'paws must be greater than the min: 2' });
        });

        it('should be able to check that a value passes a max threshold', function() {
            expect(Model.checkLimits({ __max: 4 }, 3, 'paws')).toEqual({ isValid: true });
            expect(Model.checkLimits({ __max: 4 }, 5, 'paws')).toEqual({ isValid: false,
                reason: 'paws must be less than the max: 4' });
        });
        
        it('should be able to check that an array passes a max entry threshold', function() {
            expect(Model.checkLimits({ __length: 3 }, ['max', 'knut', 'charlie'], 'doggieFriends')).toEqual({ isValid: true });
            expect(Model.checkLimits({ __length: 3 }, ['max', 'knut', 'charlie', 'woofles'], 'doggieFriends'))
                .toEqual({ isValid: false, reason: 'doggieFriends must have less than max entries: 3' });
        });
        
        it('should be able to check that a value is in a set of acceptable values', function() {
            var cfg = { __acceptableValues: ['poodle', 'lab'] };
            expect(Model.checkLimits(cfg, 'poodle', 'breed')).toEqual({ isValid: true });
            expect(Model.checkLimits(cfg, 'lab', 'breed')).toEqual({ isValid: true });
            expect(Model.checkLimits(cfg, 'mutt', 'breed')).toEqual({ isValid: false,
                reason: 'breed is UNACCEPTABLE! acceptable values are: [poodle,lab]' });

            cfg = { __acceptableValues: '*' };
            expect(Model.checkLimits(cfg, 'mutt', 'breed')).toEqual({ isValid: true });
        });
        
        it('should be able to perform multiple checks', function() {
            var cfg = {
                __min: 10,
                __max: 20,
                __acceptableValues: [5, 15, 25]
            };
            
            expect(Model.checkLimits(cfg, 15, 'barksPerDay')).toEqual({ isValid: true });
            expect(Model.checkLimits(cfg, 5, 'barksPerDay')).toEqual({ isValid: false,
                reason: 'barksPerDay must be greater than the min: 10' });
            expect(Model.checkLimits(cfg, 25, 'barksPerDay')).toEqual({ isValid: false,
                reason: 'barksPerDay must be less than the max: 20' });
            expect(Model.checkLimits(cfg, 16, 'barksPerDay')).toEqual({ isValid: false,
                reason: 'barksPerDay is UNACCEPTABLE! acceptable values are: [5,15,25]' });
        });
    });
    
    describe('validate', function() {
        var newObj, origObj, requester, model;
        beforeEach(function() {
            model = new Model('puppies', {});
            origObj = {};
            newObj = {};
            requester = { id: 'u-1', fieldValidation: { puppies: {} } };
        });
        
        describe('if a field is required', function() {
            beforeEach(function() {
                model.schema.name = {
                    __type: 'string', __required: true, __allowed: true
                };
            });

            it('should fail if the field is not present on the newObj', function() {
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'Missing required field: name' });
                expect(model.validate('edit', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'Missing required field: name' });
            });
            
            it('should pass if the field is present on the newObj', function() {
                newObj.name = 'scruffles';
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'scruffles' });
            });

            it('should pass if the field is present on the origObj', function() {
                origObj.name = 'puffles';
                expect(model.validate('edit', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'puffles' });
                newObj.name = 'scruffles';
                expect(model.validate('edit', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'scruffles' });
            });
        });
        
        describe('if a field is forbidden', function() {
            beforeEach(function() {
                model.schema.name = {
                    __type: 'string', __allowed: false
                };
            });
            
            it('should trim the field off if present on newObj', function() {
                newObj.name = 'scruffles';
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({});
            });
            
            it('should revert to the existing value if present on newObj and origObj', function() {
                origObj.name = 'puffles';
                newObj.name = 'scruffles';
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'puffles' });
            });
            
            it('should pass if the field is not set on newObj', function() {
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({});
            });
        });
        
        describe('if a field can only be set once', function() {
            beforeEach(function() {
                model.schema.name = {
                    __type: 'string', __allowed: true, __unchangeable: true
                };
            });
            
            it('should allow the field to be set if previously unset', function() {
                newObj.name = 'scruffles';
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'scruffles' });
            });
            
            it('should trim the field if it was previously set', function() {
                origObj.name = 'puffles';
                newObj.name = 'scruffles';
                expect(model.validate('edit', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'puffles' });
            });
            
            it('should pass if the field is not set on newObj', function() {
                expect(model.validate('edit', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({});
            });
        });
        
        describe('if a field has __type === Date', function() {
            beforeEach(function() {
                model.schema.born = {
                    __type: 'Date', __allowed: true
                };
            });

            it('should cast date strings to Dates', function() {
                newObj.born = '2015-08-06T14:31:17.199Z';
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ born: new Date('2015-08-06T14:31:17.199Z') });
            });
            
            it('should fail if a string is not a valid date', function() {
                newObj.born = '201512341234-08-06T14:31:17.199Z';
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'born must be in format: Date' });
            });
            
            it('should leave Date objects alone', function() {
                newObj.born = new Date('2015-08-06T14:31:17.199Z');
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ born: new Date('2015-08-06T14:31:17.199Z') });
            });
        });
        
        describe('if a field has a __type specified', function() {
            beforeEach(function() {
                model.schema.doggieFriends = {
                    __type: 'stringArray', __allowed: true
                };
            });
            
            it('should pass if the value is the correct type', function() {
                newObj.doggieFriends = ['knut', 'charlie'];
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ doggieFriends: ['knut', 'charlie'] });
            });

            it('should fail if the value is not the correct type', function() {
                newObj.doggieFriends = ['knut', 'charlie', 7];
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'doggieFriends must be in format: stringArray' });
            });

            it('should pass if the value is not set on newObj', function() {
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({});
            });
        });
        
        describe('if a field has limit props specified', function() {
            beforeEach(function() {
                model.schema.paws = {
                    __type: 'number', __allowed: true, __min: 2, __max: 4
                };
            });
            
            it('should pass if the value fits the limits', function() {
                newObj.paws = 3;
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ paws: 3 });
            });

            it('should fail if the value fals outside the limits', function() {
                newObj.paws = 1;
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'paws must be greater than the min: 2' });
            });

            it('should pass if the value is not set on newObj', function() {
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({});
            });
        });
        
        describe('when handling nested fields', function() {
            beforeEach(function() {
                model.schema.snax = {
                    bacon: {
                        __type: 'string', __allowed: true, __acceptableValues: '*'
                    },
                    vegetables: {
                        __type: 'string', __allowed: true, __acceptableValues: '*'
                    },
                    kibbles: {
                        __type: 'string', __allowed: true, __acceptableValues: ['yes', 'no']
                    },
                    chocolate: {
                        __allowed: false
                    }
                };
            });
            
            it('should pass if all subfields validate', function() {
                newObj.snax = {
                    kibbles: 'yes', bacon: 'always', chocolate: 'do want'
                };
                
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ snax: { kibbles: 'yes', bacon: 'always' } });
            });
            
            it('should fail if one of the subfields fails validation', function() {
                newObj.snax = {
                    kibbles: 'maybe', bacon: 'always', chocolate: 'do want'
                };
                
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'snax.kibbles is UNACCEPTABLE! acceptable values are: [yes,no]' });
            });
            
            it('should trim the entire block if the whole block is forbidden', function() {
                model.schema.snax.__allowed = false;
                newObj.snax = {
                    kibbles: 'yes', bacon: 'always', chocolate: 'do want'
                };
                
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({});
            });
        });
        
        describe('when handling array fields', function() {
            beforeEach(function() {
                model.schema.doggieFriends = {
                    __type: 'stringArray', __length: 3, __entries: { __acceptableValues: ['knut', 'charlie', 'scruffles', 'puffles'] }
                };
            });
            
            it('should fail if some of the entries are not the right type', function() {
                newObj.doggieFriends = ['knut', 'scruffles', 55];
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'doggieFriends must be in format: stringArray' });
            });

            it('should be able to check that there are less than a max # of entries', function() {
                newObj.doggieFriends = ['knut', 'scruffles', 'charlie', 'puffles'];
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'doggieFriends must have less than max entries: 3' });
            });
            
            it('should be able to validate every entry using the __entries property', function() {
                newObj.doggieFriends = ['knut', 'scruffles', 'woofles'];
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'doggieFriends[2] is UNACCEPTABLE! acceptable values are: [knut,charlie,scruffles,puffles]' });
            });
            
            it('should be able to recursively validate fields on object entries', function() {
                model.schema.doggieFriends = {
                    __type: 'objectArray',
                    __entries: {
                        name: {
                            __type: 'string', __allowed: true
                        },
                        paws: {
                            __type: 'number', __allowed: true, __min: 2, __max: 4
                        }
                    }
                };
                newObj.doggieFriends = [
                    { name: 'knut', paws: 4 },
                    { name: 'scruffles', paws: 3 },
                ];
                
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj.doggieFriends).toEqual([
                    { name: 'knut', paws: 4 },
                    { name: 'scruffles', paws: 3 }
                ]);
                
                newObj.doggieFriends.push({name: 'woofles', paws: 5});
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'doggieFriends[2].paws must be less than the max: 4' });
                    
                model.schema.doggieFriends.__entries.paws.__allowed = false;
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj.doggieFriends).toEqual([
                    { name: 'knut' },
                    { name: 'scruffles' },
                    { name: 'woofles' }
                ]);
            });
        });
    });
    
    describe('midWare', function() {
        var model, req, nextSpy, doneSpy;
        beforeEach(function() {
            model = new Model('puppies', { woof: 'yes', meow: 'no' });
            req = { body: { name: 'woofles', dog: 'yes' }, user: { id: 'u-1' } };
            spyOn(model, 'validate').andReturn({ isValid: true });
            nextSpy = jasmine.createSpy('next()');
            doneSpy = jasmine.createSpy('done()');
        });

        it('should call next if req.body passes validate()', function(done) {
            model.midWare('create', req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(model.validate).toHaveBeenCalledWith('create', req.body, {}, { id: 'u-1' });
                expect(req.body).toEqual({ name: 'woofles', dog: 'yes' });
                done();
            });
        });
        
        it('should pass in the origObj if defined', function(done) {
            req.origObj = { name: 'woofles', dog: 'maybe' };
            model.midWare('edit', req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(model.validate).toHaveBeenCalledWith('edit', req.body, { name: 'woofles', dog: 'maybe' }, { id: 'u-1' });
                expect(req.body).toEqual({ name: 'woofles', dog: 'yes' });
                done();
            });
        });

        it('should call done if req.body fails validate()', function(done) {
            model.validate.andReturn({ isValid: false, reason: 'woofles is actually a cat' });
            model.midWare('create', req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'woofles is actually a cat' });
                expect(model.validate).toHaveBeenCalled();
                done();
            });
        });
    });
});
