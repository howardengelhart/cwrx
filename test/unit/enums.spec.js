var flush = true;
describe('enums', function() {
    var enums;
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        enums = require('../../lib/enums');
    });

    it('should define constants correctly', function() {
        expect(enums.Status.Draft).toBe('draft');
        expect(enums.Status.New).toBe('new');
        expect(enums.Status.Pending).toBe('pending');
        expect(enums.Status.Approved).toBe('approved');
        expect(enums.Status.Rejected).toBe('rejected');
        expect(enums.Status.Active).toBe('active');
        expect(enums.Status.Paused).toBe('paused');
        expect(enums.Status.Inactive).toBe('inactive');
        expect(enums.Status.Expired).toBe('expired');
        expect(enums.Status.OutOfBudget).toBe('outOfBudget');
        expect(enums.Status.Canceled).toBe('canceled');
        expect(enums.Status.Deleted).toBe('deleted');
        expect(enums.Status.Error).toBe('error');

        expect(enums.Access.Public).toBe('public');
        expect(enums.Access.Private).toBe('private');

        expect(enums.Scope.Own).toBe('own');
        expect(enums.Scope.Org).toBe('org');
        expect(enums.Scope.All).toBe('all');
        expect(enums.Scope.Deny).toBe('deny');
    });

    it('should be frozen', function() {
        enums.Access.Public = 'foo';
        expect(enums.Access.Public).toBe('public');
        delete enums.Status.Pending;
        expect(enums.Status.Pending).toBe('pending');
        var fakeFunc = function() { console.log('i\'m in ur enums messing up ur scopes'); };
        enums.Scope._getVal = fakeFunc;
        expect(enums.Scope._getVal).not.toBe(fakeFunc);
        enums.Foo = { blah: 'bloop' };
        expect(enums.Foo).not.toBeDefined();
    });

    describe('Scope._getVal', function() {
        it('should successfully translate strings to values', function() {
            expect(enums.Scope._getVal('own')).toBe(1);
            expect(enums.Scope._getVal('org')).toBe(2);
            expect(enums.Scope._getVal('all')).toBe(3);
            expect(enums.Scope._getVal('foo')).toBe(0);
            expect(enums.Scope._getVal({ foo: 'bar'})).toBe(0);
            expect(enums.Scope._getVal(undefined)).toBe(0);
            expect(enums.Scope._getVal(null)).toBe(0);
        });
    });

    describe('Scope.compare', function() {
        it('should correctly compare scope strings', function() {
            expect(enums.Scope.compare('own', 'all')).toBe(-2);
            expect(enums.Scope.compare('org', 'own')).toBe(1);
            expect(enums.Scope.compare('all', 'all')).toBe(0);
            expect(enums.Scope.compare('all', 'bloop')).toBe(3);
        });
    });

    describe('Scope.isScope', function() {
        it('should check if the string is one of the enumerated scopes', function() {
            expect(enums.Scope.isScope('own')).toBe(true);
            expect(enums.Scope.isScope('org')).toBe(true);
            expect(enums.Scope.isScope('all')).toBe(true);
            expect(enums.Scope.isScope('deny')).toBe(true);
            expect(enums.Scope.isScope('fake')).toBe(false);
        });
    });
});
