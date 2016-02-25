#!/bin/sh
# This script will setup a postgres test db to use for querybot.  You can run this
# after the first time you run (after a vagrant destroy):
#
#    $ grunt vagrant:up --service=querybot
#    $ scripts/initcamp.sh --init
#
# You can re-run to reset the test db - omit the --init arg
#
#    $ scripts/initcamp.sh
#
# IMPORTANT:  For this to work you need to have the postgresql client tools
# installed on your dev machine, and in your PATH
#

export PGHOST=33.33.33.10
export PGUSER=c6admin
export PGPASSWORD=abc12345
export PGDATABASE=template1

if [  "$1" = "-init" ] || [ "$1" = "--init" ]; then

    if [ -n "$2" ]; then
        export PGHOST=$2
    fi
    
    # These are things you should only do once, just after you've
    # installed pg on your vagrant box (using the c6postgres cookbook)
    psql -c "alter user c6admin with encrypted password 'password' valid until 'infinity';"

    export PGPASSWORD=password

    psql -c "CREATE ROLE viewer NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;"
    psql -c "CREATE USER cwrx WITH CREATEDB LOGIN PASSWORD 'password';"
    psql -c "CREATE USER sixxy WITH NOCREATEDB NOCREATEROLE LOGIN PASSWORD 'password';"
    psql -c "GRANT viewer TO sixxy;"
elif [ -n "$1" ]; then
    export PGHOST=$1
fi


# From here down we're destroying and recreating our test db
export PGUSER=cwrx
export PGPASSWORD=password

dropdb 'campfire_cwrx'
createdb 'campfire_cwrx'

export PGDATABASE='campfire_cwrx'

psql -c "CREATE SCHEMA rpt;"
psql -c "GRANT USAGE ON SCHEMA rpt TO viewer;"

read -r -d '' campaign_summary_hourly_all <<- EOM
CREATE TABLE rpt.campaign_summary_hourly_all
(
    rec_ts timestamp with time zone,
    campaign_id character varying(20),
    event_type character varying(100),
    events bigint,
    event_cost numeric(12,4),
    CONSTRAINT uc_campaign_summary_hourly_all UNIQUE (rec_ts,campaign_id,event_type)
) WITH ( OIDS=FALSE);
EOM

psql -c "${campaign_summary_hourly_all}"
psql -c "GRANT SELECT ON TABLE rpt.campaign_summary_hourly_all TO viewer;"
