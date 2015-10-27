(function(){
    'use strict';

    var enums = {
        Status: {
            Draft       : 'draft',
            New         : 'new',
            Pending     : 'pending',
            Approved    : 'approved', //TODO: test these
            Rejected    : 'rejected',
            Active      : 'active',
            Paused      : 'paused',
            Inactive    : 'inactive',
            Expired     : 'expired',
            Canceled    : 'canceled',
            Deleted     : 'deleted',
            Error       : 'error'
        },
        Access: {
            Public: 'public',
            Private: 'private'
        },
        Scope: {
            Own: 'own',
            Org: 'org',
            All: 'all',
            Deny: 'deny',
            _getVal: function(str) {
                switch (str) {
                    case 'deny':
                        return 0;
                    case 'own':
                        return 1;
                    case 'org':
                        return 2;
                    case 'all':
                        return 3;
                    default:
                        return 0;
                }
            },
            compare: function(a, b) {
                return this._getVal(a) - this._getVal(b);
            },
            isScope: function(str) {
                return str === 'own' || str === 'org' || str === 'all' || str === 'deny';
            }
        }
    };

    Object.freeze(enums.Status);
    Object.freeze(enums.Access);
    Object.freeze(enums.Scope);
    Object.freeze(enums);

    module.exports = enums;
}());
