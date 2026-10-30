#!/bin/sh
# Recreates the scratch e2e database: auth shim + real migrations + seed + an admin account.
set -e
P="psql -h /tmp -p 54329 -U postgres -X -q -v ON_ERROR_STOP=1"
DIR=$(cd "$(dirname "$0")/../.." && pwd)
$P -d postgres -c "drop database if exists resumed_e2e with (force)" -c "create database resumed_e2e" >/dev/null
$P -d resumed_e2e -f "$DIR/tests/sql/00_auth_shim.sql" >/dev/null
$P -d resumed_e2e -f "$DIR/supabase/migrations/001_schema.sql" 2>&1 | grep -v NOTICE || true
$P -d resumed_e2e -f "$DIR/supabase/migrations/002_seed_year1_curriculum.sql" >/dev/null
$P -d resumed_e2e -f "$DIR/supabase/migrations/003_year2.sql" >/dev/null
$P -d resumed_e2e -f "$DIR/supabase/migrations/004_year3.sql" >/dev/null
$P -d resumed_e2e -f "$DIR/supabase/migrations/005_stage_journal.sql" >/dev/null
# the configured admin e-mail, already confirmed (as after clicking the confirmation e-mail)
$P -d resumed_e2e -c "insert into auth.users (email, encrypted_password, email_confirmed_at) values ('ckm25.dz@gmail.com', crypt('AdminPass#2026', gen_salt('bf', 4)), now())" >/dev/null
$P -d resumed_e2e -t -A -c "select email, role, status from public.profiles"
