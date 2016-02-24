var flush = true;
describe('historian', function() {
    var historian, Status, req;

    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        historian       = require('../../lib/historian');
        Status          = require('../../lib/enums').Status;

        req = {
            uuid: '123456',
            user: { id: 'u-1', email: 'evan@c6.com' }
        };
    });

    describe('historify', function() {
        var oldDate, body, origObj;
        beforeEach(function() {
            oldDate = new Date(Date.now() - 5000);
            body = {
                status: Status.Active,
                lunch: { olives: 'no' }
            };

            origObj = {
                lunch: { olives: 'yes' },
                lunchHistory: [{
                    lunch: { olives: 'yes' },
                    userId: 'u-2',
                    user: 'josh@c6.com',
                    date: oldDate
                }]
            };
        });
        
        it('should throw an error if not provided a field or historyField', function() {
            var msg = 'Must provide field name + history field name';
            expect(function() { historian.historify(null, 'lunchHistory', body, origObj, req); }).toThrow(new Error(msg));
            expect(function() { historian.historify('lunch', undefined, body, origObj, req); }).toThrow(new Error(msg));
        });
        
        it('should do nothing if body[field] is not defined', function() {
            delete body.lunch;
            historian.historify('lunch', 'lunchHistory', body, origObj, req);
            expect(body).toEqual({
                status: Status.Active
            });
        });

        it('should do nothing if the field is unchanged', function() {
            body.lunch.olives = 'yes';
            historian.historify('lunch', 'lunchHistory', body, origObj, req);
            expect(body).toEqual({
                status: Status.Active,
                lunch: { olives: 'yes' }
            });
        });
        
        it('should add an entry to historyField', function() {
            historian.historify('lunch', 'lunchHistory', body, origObj, req);
            expect(body).toEqual({
                status: Status.Active,
                lunch: { olives: 'no' },
                lunchHistory: jasmine.any(Array)
            });
            expect(body.lunchHistory).toEqual([
                {
                    lunch: { olives: 'no' },
                    userId: 'u-1',
                    user: 'evan@c6.com',
                    date: jasmine.any(Date)
                },
                {
                    lunch: { olives: 'yes' },
                    userId: 'u-2',
                    user: 'josh@c6.com',
                    date: oldDate
                }
            ]);
            expect(body.lunchHistory[0].date).toBeGreaterThan(oldDate);
        });
        
        it('should initalize the historyField if not defined', function() {
            delete origObj.lunchHistory;
            historian.historify('lunch', 'lunchHistory', body, origObj, req);
            expect(body).toEqual({
                status: Status.Active,
                lunch: { olives: 'no' },
                lunchHistory: jasmine.any(Array)
            });
            expect(body.lunchHistory).toEqual([
                {
                    lunch: { olives: 'no' },
                    userId: 'u-1',
                    user: 'evan@c6.com',
                    date: jasmine.any(Date)
                }
            ]);
            expect(body.lunchHistory[0].date).toBeGreaterThan(oldDate);
        });
        
        it('should add a different history entry if the requester is an app', function() {
            delete req.user;
            req.application = { id: 'app-1', key: 'watchman' };

            historian.historify('lunch', 'lunchHistory', body, origObj, req);
            expect(body).toEqual({
                status: Status.Active,
                lunch: { olives: 'no' },
                lunchHistory: jasmine.any(Array)
            });
            expect(body.lunchHistory).toEqual([
                {
                    lunch: { olives: 'no' },
                    appId: 'app-1',
                    appKey: 'watchman',
                    date: jasmine.any(Date)
                },
                {
                    lunch: { olives: 'yes' },
                    userId: 'u-2',
                    user: 'josh@c6.com',
                    date: oldDate
                }
            ]);
            expect(body.lunchHistory[0].date).toBeGreaterThan(oldDate);
        });
        
        it('should delete the existing historyField off the body', function() {
            body = {
                status: Status.Active,
                lunchHistory: [{
                    lunch: { ticos: 'yes' },
                    userId: 'u-3',
                    user: 'scott@c6.com',
                    date: new Date()
                }]
            };
            historian.historify('lunch', 'lunchHistory', body, origObj, req);
            expect(body.lunchHistory).not.toBeDefined();
        });
        
        it('should update the latest historyField entry if the status is draft', function() {
            body.status = Status.Draft;
            historian.historify('lunch', 'lunchHistory', body, origObj, req);
            expect(body.lunchHistory).toEqual([{
                lunch: { olives: 'no' },
                userId: 'u-1',
                user: 'evan@c6.com',
                date: jasmine.any(Date)
            }]);
        });
        
        it('should be able to use the status on the origObj', function() {
            delete body.status;
            origObj.status = Status.Draft;
            historian.historify('lunch', 'lunchHistory', body, origObj, req);
            expect(body.lunchHistory).toEqual([{
                lunch: { olives: 'no' },
                userId: 'u-1',
                user: 'evan@c6.com',
                date: jasmine.any(Date)
            }]);
        });
    });
    
    describe('middlewarify', function() {
        it('should return a function', function() {
            expect(historian.middlewarify('lunch', 'lunchHistory')).toEqual(jasmine.any(Function));
        });
        
        describe('returns a function that', function() {
            var midware, next, done;
            beforeEach(function() {
                midware = historian.middlewarify('lunch', 'lunchHistory');
                req.body = { lunch: 'yes' };
                req.origObj = { lunch: 'later' };
                spyOn(historian, 'historify').and.callThrough();
                
                next = jasmine.createSpy('next');
                done = jasmine.createSpy('done');
            });

            it('should call historify', function() {
                midware(req, next, done);
                expect(next).toHaveBeenCalled();
                expect(done).not.toHaveBeenCalled();
                expect(historian.historify).toHaveBeenCalledWith('lunch', 'lunchHistory', req.body, req.origObj, req);
                expect(req.body.lunchHistory).toEqual(jasmine.any(Array));
            });
        });
    });
});
