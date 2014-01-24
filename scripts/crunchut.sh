#!/bin/bash

grep 'testsuite name=' $1/*.xml | sed 's/.*testsuite name=\"\(.*\)\" errors=.* time=\"\(.*\)\" timestamp.*/\1;\2/g'
