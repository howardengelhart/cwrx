(function(){
    'use strict';
    
    var enums = {
        Status: {
            Active: 'active',
            Inactive: 'inactive',
            Pending: 'pending',
            Deleted: 'deleted'
        },
        Access: {
            Public: 'public',
            Private: 'private'
        },
        Scope: {
            Own: 'own',
            Org: 'org',
            All: 'all',
            getVal: function(str) {
                switch (str) {
                    case 'own':
                        return 1;
                    case 'org':
                        return 2;
                    case 'all':
                        return 3;
                    default:
                        return 0;
                }
            }
        }
    };
    
    Object.freeze(enums.Status);
    Object.freeze(enums.Access);
    Object.freeze(enums.Scope);
    Object.freeze(enums);
    
    module.exports = enums;
}());
