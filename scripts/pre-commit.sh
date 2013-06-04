#!/bin/bash

echo 'Running jshint...'

node_modules/jshint/bin/jshint --config jshint.json bin/* lib/*

RETVAL=$?
if [ $RETVAL -ne 0 ]
then
    echo 'jshint has errors, fix before proceding.'
    exit 1;
fi

echo 'Running npm test...'

npm test

RETVAL=$?
if [ $RETVAL -ne 0 ]
then
    echo 'npm test has errors, fix before proceding.'
    exit 2;
fi

exit 0;
