var flush = true;
describe('Model', function() {
    var q, mockLog, logger, Model, enums, AccessLevel;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        Model           = require('../../lib/model');
        q               = require('q');
        logger          = require('../../lib/logger');
        enums           = require('../../lib/enums');
        AccessLevel     = enums.AccessLevel;

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
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
                    _type: 'string', _accessLevel: AccessLevel.Forbidden, _locked: true
                },
                born: {
                    _type: Date, _accessLevel: AccessLevel.Forbidden
                },
                name: {
                    _type: 'string', _accessLevel: AccessLevel.Forbidden
                },
                paws: {
                    _type: 'number', _accessLevel: AccessLevel.Limited, _min: 2
                },
                snax: {
                    kibbles: {
                        _type: 'string', _accessLevel: AccessLevel.Allowed, _acceptableValues: ['yes', 'no']
                    },
                    bacon: {
                        _type: 'string', _accessLevel: AccessLevel.Allowed, _acceptableValues: '*'
                    },
                }
            });
            requester = {
                id: 'u-1',
                fieldValidation: {
                    kitties: { name: { _required: true } },
                    puppies: {
                        name: {
                            _accessLevel: AccessLevel.Allowed
                        },
                        snax: {
                            kibbles: {
                                _acceptableValues: ['very yes']
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
                    _type: 'string', _accessLevel: AccessLevel.Forbidden, _locked: true
                },
                born: {
                    _type: Date, _accessLevel: AccessLevel.Forbidden
                },
                name: {
                    _type: 'string', _accessLevel: AccessLevel.Allowed
                },
                paws: {
                    _type: 'number', _accessLevel: AccessLevel.Limited, _min: 2
                },
                snax: {
                    kibbles: {
                        _type: 'string', _accessLevel: AccessLevel.Allowed, _acceptableValues: ['very yes']
                    },
                    bacon: {
                        _type: 'string', _accessLevel: AccessLevel.Allowed, _acceptableValues: '*'
                    },
                }
            });
        });
        
        it('should not be able to overwrite _locked fields on the default schema', function() {
            requester.fieldValidation.puppies.id = { _accessLevel: AccessLevel.Allowed, _min: 10 };
            var personalized = model.personalizeSchema(requester);
            expect(personalized).not.toEqual(model.schema);
            expect(personalized.id).toEqual({
                _type: 'string', _accessLevel: AccessLevel.Forbidden, _locked: true
            });
        });
        
        it('should not be able to overwrite _type settings on the default schema', function() {
            requester.fieldValidation.puppies.name = {
                _type: 'object', _accessLevel: AccessLevel.Allowed,
            };
            var personalized = model.personalizeSchema(requester);
            expect(personalized).not.toEqual(model.schema);
            expect(personalized.name).toEqual({
                _type: 'string', _accessLevel: AccessLevel.Allowed
            });
        });
        
        it('should not screw up dates', function() {
            var now = new Date(),
                later = new Date(now + 1000);
            model.schema.born._default = now;
            requester.fieldValidation.puppies.born = { _default: later };
            
            var personalized = model.personalizeSchema(requester);
            expect(personalized.born).toEqual({
                _type: Date, _accessLevel: AccessLevel.Forbidden, _default: later
            });
        });
        
        it('should allow the requester\'s fieldValidation to define configs for new fields', function() {
            requester.fieldValidation.puppies.likesCats = {
                _type: 'boolean', _accessLevel: AccessLevel.Allowed
            };
            
            var personalized = model.personalizeSchema(requester);
            expect(personalized.likesCats).toEqual({
                _type: 'boolean', _accessLevel: AccessLevel.Allowed
            });
        });
    });
    
    describe('checkFormat', function() {
        it('should handle string formats', function() {
            expect(Model.checkFormat('string', 1)).toBe(false);
            expect(Model.checkFormat('string', '1')).toBe(true);
            expect(Model.checkFormat('object', 'a')).toBe(false);
            expect(Model.checkFormat('object', { foo: 'bar' })).toBe(true);
            expect(Model.checkFormat('object', [1, 2, '3'])).toBe(false);
        });
        
        it('should handle function formats', function() {
            function MyClass() { this.foo = 'bar'; }
            expect(Model.checkFormat(Date, 'a')).toBe(false);
            expect(Model.checkFormat(Date, new Date())).toBe(true);
            expect(Model.checkFormat(MyClass, { foo: 'bar' })).toBe(false);
            expect(Model.checkFormat(MyClass, new MyClass())).toBe(true);
        });
        
        it('should handle formats with options', function() {
            expect(Model.checkFormat({or: ['string', 'number']}, 'a')).toBe(true);
            expect(Model.checkFormat({or: ['string', 'number']}, 1.5)).toBe(true);
            expect(Model.checkFormat({or: ['string', 'number']}, true)).toBe(false);
        });
        
        it('should handle array formats', function() {
            expect(Model.checkFormat(['string'], ['a', 'b'])).toBe(true);
            expect(Model.checkFormat(['string'], ['a', 1])).toBe(false);
            expect(Model.checkFormat([{or: ['string', 'number']}], ['a', 1])).toBe(true);
        });
        
        it('should log a warning if the format is invalid', function() {
            expect(Model.checkFormat({foo: 'bar'}, 'asdf')).toBe(true);
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });
    
    describe('checkLimits', function() {
        it('should return isValid = true if the config is missing or contains no limit fields', function() {
            expect(Model.checkLimits(null, 'fido', 'name')).toEqual({ isValid: true });
            expect(Model.checkLimits({ _type: 'object' }, 'fido', 'name')).toEqual({ isValid: true });
        });
        
        it('should be able to check that a value passes a min threshold', function() {
            expect(Model.checkLimits({ _min: 2 }, 4, 'paws')).toEqual({ isValid: true });
            expect(Model.checkLimits({ _min: 2 }, 1, 'paws')).toEqual({ isValid: false,
                reason: 'paws must be greater than the min: 2' });
        });

        it('should be able to check that a value passes a max threshold', function() {
            expect(Model.checkLimits({ _max: 4 }, 3, 'paws')).toEqual({ isValid: true });
            expect(Model.checkLimits({ _max: 4 }, 5, 'paws')).toEqual({ isValid: false,
                reason: 'paws must be less than the max: 4' });
        });
        
        it('should be able to check that an array passes a max entry threshold', function() {
            expect(Model.checkLimits({ _length: 3 }, ['max', 'knut', 'charlie'], 'doggieFriends')).toEqual({ isValid: true });
            expect(Model.checkLimits({ _length: 3 }, ['max', 'knut', 'charlie', 'woofles'], 'doggieFriends'))
                .toEqual({ isValid: false, reason: 'doggieFriends must have less than max entries: 3' });
        });
        
        it('should be able to check that a value is in a set of acceptable values', function() {
            var cfg = { _acceptableValues: ['poodle', 'lab'] };
            expect(Model.checkLimits(cfg, 'poodle', 'breed')).toEqual({ isValid: true });
            expect(Model.checkLimits(cfg, 'lab', 'breed')).toEqual({ isValid: true });
            expect(Model.checkLimits(cfg, 'mutt', 'breed')).toEqual({ isValid: false,
                reason: 'breed is not one of the acceptable values: [poodle,lab]' });

            cfg = { _acceptableValues: '*' };
            expect(Model.checkLimits(cfg, 'mutt', 'breed')).toEqual({ isValid: true });
        });
        
        it('should be able to perform multiple checks', function() {
            var cfg = {
                _min: 10,
                _max: 20,
                _acceptableValues: [5, 15, 25]
            };
            
            expect(Model.checkLimits(cfg, 15, 'barksPerDay')).toEqual({ isValid: true });
            expect(Model.checkLimits(cfg, 5, 'barksPerDay')).toEqual({ isValid: false,
                reason: 'barksPerDay must be greater than the min: 10' });
            expect(Model.checkLimits(cfg, 25, 'barksPerDay')).toEqual({ isValid: false,
                reason: 'barksPerDay must be less than the max: 20' });
            expect(Model.checkLimits(cfg, 16, 'barksPerDay')).toEqual({ isValid: false,
                reason: 'barksPerDay is not one of the acceptable values: [5,15,25]' });
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
                    _type: 'string', _required: true, _accessLevel: AccessLevel.Allowed
                };
            });

            it('should fail if the field is not present on the newObj', function() {
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'Missing required field: name' });
            });
            
            it('should pass if the field is present on the newObj', function() {
                newObj.name = 'scruffles';
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'scruffles' });
            });

            it('should pass if the field is present on the origObj', function() {
                origObj.name = 'puffles';
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'puffles' });
                newObj.name = 'scruffles';
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'scruffles' });
            });
        });
        
        describe('if a field is forbidden', function() {
            beforeEach(function() {
                model.schema.name = {
                    _type: 'string', _accessLevel: AccessLevel.Forbidden
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
        
        describe('if a field can only be set on create', function() {
            beforeEach(function() {
                model.schema.name = {
                    _type: 'string', _accessLevel: AccessLevel.Allowed, _createOnly: true
                };
            });
            
            it('should allow the field to be set if the action is create', function() {
                newObj.name = 'scruffles';
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'scruffles' });
            });
            
            it('should trim the field if the action is not create', function() {
                newObj.name = 'scruffles';
                expect(model.validate('edit', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({});
            });
            
            it('should revert to the existing value if present on origObj', function() {
                origObj.name = 'puffles';
                newObj.name = 'scruffles';
                expect(model.validate('edit', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'puffles' });
            });
            
            it('should pass if the field is not set on newObj', function() {
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({});
            });
        });
        
        describe('if a field has _type === Date', function() {
            beforeEach(function() {
                model.schema.born = {
                    _type: Date, _accessLevel: AccessLevel.Allowed
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
                    reason: 'born must be in format: [Function: Date]' });
            });
            
            it('should leave Date objects alone', function() {
                newObj.born = new Date('2015-08-06T14:31:17.199Z');
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({ born: new Date('2015-08-06T14:31:17.199Z') });
            });
        });
        
        describe('if a field has a _type specified', function() {
            beforeEach(function() {
                model.schema.doggieFriends = {
                    _type: ['string'], _accessLevel: AccessLevel.Allowed
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
                    reason: 'doggieFriends must be in format: [ \'string\' ]' });
            });

            it('should pass if the value is not set on newObj', function() {
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: true });
                expect(newObj).toEqual({});
            });
        });
        
        describe('if a field has limit props specified', function() {
            beforeEach(function() {
                model.schema.paws = {
                    _type: 'number', _accessLevel: AccessLevel.Allowed, _min: 2, _max: 4
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
                        _type: 'string', _accessLevel: AccessLevel.Allowed, _acceptableValues: '*'
                    },
                    vegetables: {
                        _type: 'string', _accessLevel: AccessLevel.Allowed, _acceptableValues: '*'
                    },
                    kibbles: {
                        _type: 'string', _accessLevel: AccessLevel.Allowed, _acceptableValues: ['yes', 'no']
                    },
                    chocolate: {
                        _accessLevel: AccessLevel.Forbidden
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
                    reason: 'snax.kibbles is not one of the acceptable values: [yes,no]' });
            });
            
            it('should trim the entire block if the whole block is forbidden', function() {
                model.schema.snax._accessLevel = AccessLevel.Forbidden;
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
                    _type: ['string'], _length: 3, _entries: { _acceptableValues: ['knut', 'charlie', 'scruffles', 'puffles'] }
                };
            });
            
            it('should fail if some of the entries are not the right type', function() {
                newObj.doggieFriends = ['knut', 'scruffles', 55];
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'doggieFriends must be in format: [ \'string\' ]' });
            });

            it('should be able to check that there are less than a max # of entries', function() {
                newObj.doggieFriends = ['knut', 'scruffles', 'charlie', 'puffles'];
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'doggieFriends must have less than max entries: 3' });
            });
            
            it('should be able to validate every entry using the _entries property', function() {
                newObj.doggieFriends = ['knut', 'scruffles', 'woofles'];
                expect(model.validate('create', newObj, origObj, requester)).toEqual({ isValid: false,
                    reason: 'doggieFriends[2] is not one of the acceptable values: [knut,charlie,scruffles,puffles]' });
            });
            
            it('should be able to recursively validate fields on object entries', function() {
                model.schema.doggieFriends = {
                    _type: ['object'],
                    _entries: {
                        name: {
                            _type: 'string', _accessLevel: AccessLevel.Allowed
                        },
                        paws: {
                            _type: 'number', _accessLevel: AccessLevel.Allowed, _min: 2, _max: 4
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
                    
                model.schema.doggieFriends._entries.paws._accessLevel = AccessLevel.Forbidden;
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
