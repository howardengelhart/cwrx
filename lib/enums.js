(function(){
    'use strict';
    
    var enums = {
        Status: {
            Active: 'active',
            Inactive: 'inactive',
            Pending: 'pending',
            Deleted: 'deleted'
        },
        AccessLevel: { //TODO: integrate createOnly + required here? do we even an enum?
            Forbidden: 'forbidden',
            Allowed: 'allowed'
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
    Object.freeze(enums.AccessLevel);
    Object.freeze(enums.Scope);
    Object.freeze(enums);
    
    module.exports = enums;
}());
