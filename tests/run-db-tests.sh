#!/bin/sh
# Runs the SQL test-suite against a scratch local PostgreSQL (port 54329, socket /tmp).
set -e
P="psql -h /tmp -p 54329 -U postgres -X -q -v ON_ERROR_STOP=1"
DIR=$(cd "$(dirname "$0")/.." && pwd)
$P -d postgres -c "drop database if exists resumed_dbtest with (force)" -c "create database resumed_dbtest" >/dev/null 2>&1
$P -d resumed_dbtest -f "$DIR/tests/sql/00_auth_shim.sql" >/dev/null
$P -d resumed_dbtest -f "$DIR/supabase/migrations/001_schema.sql" 2>&1 | grep -v NOTICE || true
$P -d resumed_dbtest -f "$DIR/supabase/migrations/001_schema.sql" 2>&1 | grep -v NOTICE || true   # idempotency
$P -d resumed_dbtest -f "$DIR/supabase/migrations/002_seed_year1_curriculum.sql" >/dev/null
$P -d resumed_dbtest -f "$DIR/supabase/migrations/002_seed_year1_curriculum.sql" >/dev/null       # idempotency
$P -d resumed_dbtest -f "$DIR/supabase/migrations/003_year2.sql" >/dev/null
$P -d resumed_dbtest -f "$DIR/supabase/migrations/003_year2.sql" >/dev/null                    # idempotency
$P -d resumed_dbtest -f "$DIR/tests/sql/10_security_and_persistence.sql" 2>&1 | sed 's/^psql:[^ ]* //' | grep -E "PASS|FAIL|ERROR|ALL"
$P -d resumed_dbtest -f "$DIR/tests/sql/20_timer.sql" 2>&1 | sed 's/^psql:[^ ]* //' | grep -E "PASS|FAIL|ERROR|ALL"
