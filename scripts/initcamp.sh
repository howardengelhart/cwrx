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
    # These are things you should only do once, just after you've
    # installed pg on your vagrant box (using the c6postgres cookbook)
    psql -c "alter user c6admin with encrypted password 'password' valid until 'infinity';"

    export PGPASSWORD=password

    psql -c "CREATE ROLE viewer NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;"
    psql -c "CREATE USER cwrx WITH CREATEDB LOGIN PASSWORD 'password';"
    psql -c "CREATE USER sixxy WITH NOCREATEDB NOCREATEROLE LOGIN PASSWORD 'password';"
    psql -c "GRANT viewer TO sixxy;"
fi

# From here down we're destroying and recreating our test db
export PGUSER=cwrx
export PGPASSWORD=password

dropdb 'campfire_cwrx'
createdb 'campfire_cwrx'

export PGDATABASE='campfire_cwrx'

psql -c "CREATE SCHEMA rpt;"
psql -c "GRANT USAGE ON SCHEMA rpt TO viewer;"

read -r -d '' campaign_crosstab_live <<- EOM
CREATE TABLE rpt.campaign_crosstab_live
(
    campaign_id character varying(20),
    impressions integer,
    plays integer,
    views integer,
    total_spend numeric(16,4),
    q1 integer,
    q2 integer,
    q3 integer,
    q4 integer,
    link_action integer,
    link_facebook integer,
    link_twitter integer,
    link_website integer,
    link_youtube integer,
    CONSTRAINT uc_campaign_crosstab_live UNIQUE (campaign_id)
) WITH ( OIDS=FALSE);
EOM

psql -c "${campaign_crosstab_live}"
psql -c "GRANT SELECT ON TABLE rpt.campaign_crosstab_live TO viewer;"


read -r -d '' campaign_daily_crosstab_live <<- EOM
CREATE TABLE rpt.campaign_daily_crosstab_live
(
    rec_date date,
    campaign_id character varying(20),
    impressions integer,
    plays integer,
    views integer,
    total_spend numeric(16,4),
    q1 integer,
    q2 integer,
    q3 integer,
    q4 integer,
    link_action integer,
    link_facebook integer,
    link_twitter integer,
    link_website integer,
    link_youtube integer,
    CONSTRAINT uc_campaign_daily_crosstab_live UNIQUE (rec_date, campaign_id)
) WITH ( OIDS=FALSE);
EOM

psql -c "${campaign_daily_crosstab_live}"
psql -c "GRANT SELECT ON TABLE rpt.campaign_daily_crosstab_live TO viewer;"
