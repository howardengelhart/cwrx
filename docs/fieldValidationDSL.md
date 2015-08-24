Field Validation Guide
======================

## Overview
Field validation is a system by which our services will validate requests to create or edit our database entities (experiences, campaigns, users, etc.). This is more granular than the permissions system, which controls at a high level which entities a user can read, create, edit, or delete.

Every API service that manages a set of database entities will have an internal model which defines a basic set of validation rules for that entity. These rules help guarantee that user input is valid and can also restrict the functionality that users have access to (for example, restricting users to a max of 1 sponsored card in a campaign). The model's set of rules, or schema, is represented as a javascript object that is intended to closely mimic 

## Field Validation Directives

### _allowed:
- **Expected type**: `Boolean`
- If true, the user may define a value for this field.
- If false, the field will be trimmed, or reset to the value on the original object.

### _required
- **Expected type**: `Boolean`
- If true, the field must be set on `'create'`. Failing to set the field will return a 400 to the client.
- On `'edit'`, if the field is not set on the request, the field will be copied from the original object.

### _createOnly
- **Expected type**: `Boolean`
- If true, the field can *only* be set on `'create'`.
- On `'edit'`, the field will be copied from the original object.

### _type
- **Expected type**: `String`, `Function`, `Object`, or `Array`
- Specifies the intended type of the field.
- If the field does not match this type, a 400 is returned.
- options:
    - if `schema._type` is a `String`: checks that `typeof value === schema._type`
    - if `schema._type` is a `Function`: checks that `value instanceof schema._type`
        - if `schema._type === Date`, will first attempt to parse a string value as a `Date` using `new Date(value)`
    - if `schema._type` is an `Array`:
        - `schema._type` must have one entry, which is any other valid `_type`
        - checks that `value instanceof Array`, and that every entry in `value` matches `schema._type[0]`
    - if `schema._type` is an `Object`:
        - must be `{ or: [<type1>, <type2>, ...] }` where `type1` etc. are valid `_type` formats
        - checks that the value matches at least one of the type options

### _locked
- **Expected type**: `Boolean`
- If true, the configuration for this field cannot be overriden by the requester's `fieldValidation`.

### _entries
- **Expected type**: `Object`
- Defines validation rules for every entry of an array field.
- Validation will be performed for every entry in the array field,

### _default
- **Expected type**: any
- Defines a default value for the field.
- If the field is not set on the request or original object, this value will be used.

### _min
- **Expected type**: `Number`
- Defines a minimum value for the field.
- If the value in the request is less than this minimum value, a 400 is returned.

### _max
- **Expected type**: `Number`
- Defines a maximum value for the field.
- If the value in the request is greater than this maximum value, a 400 is returned.

### _length
- **Expected type**: `Number`
- Defines a max length for an array field.
- If the value in the request has more entries than this threshold, a 400 is returned.

### _acceptableValues
- **Expected type**: `Array` or `'*'`
- Defines a set of acceptable values for the field.
- If this is an array, the value in the request must equal one of the entries in the array; otherwise a 400 is returned.
- If this is '*', any value is permissible.

