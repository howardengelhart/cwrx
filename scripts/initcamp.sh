#!/bin/bash
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

    psql -c "CREATE ROLE editor NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;"
    psql -c "CREATE USER cwrx WITH CREATEDB LOGIN PASSWORD 'password';"
    psql -c "CREATE USER sixxy WITH NOCREATEDB NOCREATEROLE LOGIN PASSWORD 'password';"
    psql -c "GRANT editor TO sixxy;"
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
psql -c "GRANT USAGE ON SCHEMA rpt TO editor;"

read -r -d '' campaign_summary_hourly <<- EOM
CREATE TABLE rpt.campaign_summary_hourly
(
    rec_ts timestamp with time zone,
    campaign_id character varying(20),
    event_type character varying(100),
    events bigint,
    event_cost numeric(12,4),
    CONSTRAINT uc_campaign_summary_hourly UNIQUE (rec_ts,campaign_id,event_type)
) WITH ( OIDS=FALSE);
EOM

psql -c "${campaign_summary_hourly}"
psql -c "GRANT SELECT ON TABLE rpt.campaign_summary_hourly TO editor;"


psql -c "CREATE SCHEMA dim;"
psql -c "GRANT USAGE ON SCHEMA dim TO editor;"

read -r -d '' transactions <<- EOM
CREATE TABLE dim.transactions
(
    -- rec_key bigserial NOT NULL,
    id character varying(20) NOT NULL,
    rec_ts timestamp with time zone NOT NULL,
    amount numeric(16, 4),
    units integer,
    org_id character varying(20) NOT NULL,
    campaign_id character varying(20),
    braintree_id character varying(20),
    promotion_id character varying(20),
    description text
    -- CONSTRAINT pkey_transactions PRIMARY KEY (rec_key)
) WITH ( OIDS=FALSE);
EOM

psql -c "${transactions}"
psql -c "GRANT SELECT, INSERT ON TABLE dim.transactions TO editor;"

# TODO: re-add this...
#read -r -d '' transactions_rec_key <<- EOM
#CREATE SEQUENCE dim.transactions_rec_key_seq
#    START WITH 1
#    INCREMENT BY 1
#    NO MINVALUE
#    NO MAXVALUE
#    CACHE 1;

#ALTER SEQUENCE transactions_rec_key_seq OWNED BY dim.transactions.rec_key;
#GRANT ALL ON TABLE transactions_rec_key_seq TO viewer;
#EOM

#psql -c "${transactions}"
#psql -c "GRANT SELECT, INSERT ON TABLE dim.transactions TO editor;"

