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

if [ -n "$1" ]; then
    export PGHOST=$1
fi

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

read -r -d '' billing_transactions <<- EOM
CREATE TABLE fct.billing_transactions
(
  rec_key bigserial NOT NULL,
  rec_ts timestamp with time zone NOT NULL,
  transaction_id character varying(20) NOT NULL,
  transaction_ts timestamp with time zone NOT NULL,
  org_id character varying(20) NOT NULL,
  amount numeric(16,4),
  sign smallint,
  units integer,
  campaign_id character varying(20),
  braintree_id character varying(36),
  promotion_id character varying(20),
  description text,
  CONSTRAINT pkey_billing_transactions PRIMARY KEY (rec_key),
  CONSTRAINT check_sign CHECK (sign = 1 OR sign = (-1))
)
WITH (
  OIDS=FALSE
);
EOM

initDb()
{
    # These are things you should only do once, just after you've
    # installed pg on your vagrant box (using the c6postgres cookbook)
    
    echo "Initialize test users, roles, reset c6admin password."
    psql -c "alter user c6admin with encrypted password 'password' valid until 'infinity';" > /dev/null

    export PGPASSWORD=password

    psql -c "CREATE ROLE editor NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;" > /dev/null
    psql -c "CREATE USER cwrx WITH CREATEDB LOGIN PASSWORD 'password';" > /dev/null
    psql -c "CREATE USER sixxy WITH NOCREATEDB NOCREATEROLE LOGIN PASSWORD 'password';" > /dev/null
    psql -c "GRANT editor TO sixxy;" > /dev/null
}

configDb()
{
    echo "Install test tables."
    export PGUSER=cwrx
    export PGPASSWORD=password

    dropdb 'campfire_cwrx' > /dev/null 2>&1
    createdb 'campfire_cwrx'

    export PGDATABASE='campfire_cwrx'

    psql -c "CREATE SCHEMA rpt;" > /dev/null
    psql -c "GRANT USAGE ON SCHEMA rpt TO editor;" > /dev/null

    psql -c "${campaign_summary_hourly}" > /dev/null
    psql -c "GRANT SELECT ON TABLE rpt.campaign_summary_hourly TO editor;" > /dev/null


    psql -c "CREATE SCHEMA fct;" > /dev/null
    psql -c "GRANT USAGE ON SCHEMA fct TO editor;" > /dev/null

    psql -c "${billing_transactions}" > /dev/null
    psql -c "GRANT SELECT, INSERT ON TABLE fct.billing_transactions TO editor;" > /dev/null
    psql -c "GRANT USAGE, SELECT ON fct.billing_transactions_rec_key_seq TO editor;" > /dev/null
}

echo "Check if init required."
`psql -tAc "select 1 from pg_roles where rolname = 'sixxy'" 2>&1`
INIT_CHECK=$?
if [ $INIT_CHECK -eq "0" ]
then
    initDb
else
    echo "Postgres already initialized."
fi

configDb

exit $?

