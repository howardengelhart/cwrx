#!/bin/sh
curl  -X POST -H 'Content-Type: application/json' -d '{ "election" : "r-738c2403d83ddc", "ballotItem" : "rv-22119a8cf9f755", "vote" : "ugly and fat" }' http://localhost:3100/api/vote
