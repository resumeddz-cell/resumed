-- Database-level tests. Run against a scratch database AFTER 00_auth_shim.sql + migrations.
-- Every check raises an exception on failure (psql runs with ON_ERROR_STOP=1).
\set QUIET on
\pset tuples_only on
\o /dev/null

-- helper: act as a given auth user (like PostgREST does), or as anon
create or replace function pg_temp.act_as(p_email text) returns void language plpgsql security definer as $$
declare u uuid;
begin
  select id into u from auth.users where email = p_email;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
end $$;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;
-- module progress exactly as the app computes it: learned lessons / active lessons (recursive)
create or replace function pg_temp.progress(p_module uuid, p_user uuid) returns numeric language sql as $$
  with recursive tree as (select id from public.modules where id = p_module
                          union all select m.id from public.modules m join tree t on m.parent_id = t.id),
  ls as (select l.id from public.lessons l join tree t on l.module_id = t.id where l.active)
  select case when count(*) = 0 then null
              else round(100.0 * count(*) filter (where lp.learned) / count(*), 1) end
    from ls left join public.lesson_progress lp on lp.lesson_id = ls.id and lp.user_id = p_user;
$$;
grant execute on function pg_temp.act_as(text), pg_temp.ok(boolean, text), pg_temp.progress(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- setup (as superuser = Supabase Auth)
delete from auth.users where email like '%@test.local' or email = 'ckm25.dz@gmail.com';
delete from public.admin_audit_log;
delete from public.lessons where title = 'Leçon ajoutée par l''admin';
-- 1. Registration creates a pending account
insert into auth.users (email, email_confirmed_at) values ('alice@test.local', now()), ('bob@test.local', now()),
                                                        ('carol@test.local', now());
select pg_temp.ok((select count(*) = 3 from public.profiles where email like '%@test.local' and status = 'pending' and role = 'student'),
                  'T1 new registrations get role=student, status=pending');

-- Initial admin: an UNCONFIRMED signup with the admin e-mail must NOT become admin
insert into auth.users (email, email_confirmed_at) values ('ckm25.dz@gmail.com', null);
select pg_temp.ok((select role = 'student' and status = 'pending' from public.profiles where email = 'ckm25.dz@gmail.com'),
                  'Admin e-mail is NOT promoted before the address is confirmed');
update auth.users set email_confirmed_at = now() where email = 'ckm25.dz@gmail.com';
select pg_temp.ok((select role = 'admin' and status = 'approved' from public.profiles where email = 'ckm25.dz@gmail.com'),
                  'Admin e-mail promoted to admin/approved once confirmed');

-- ---------------------------------------------------------------- pending users are locked out
set role authenticated;
select pg_temp.act_as('alice@test.local');
select pg_temp.ok((select count(*) = 1 from public.profiles), 'Pending user can read only her own profile');
select pg_temp.ok((select count(*) = 0 from public.modules), 'Pending user sees no modules');
do $$ begin
  perform public.set_lesson_stage((select id from public.lessons limit 1), 'learned', true);
  raise exception 'FAIL: pending user wrote progress';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS: pending user cannot write progress (%)', sqlerrm;
end $$;
do $$ begin
  insert into public.planner_tasks (user_id, title, task_date) values (auth.uid(), 'x', current_date);
  raise exception 'FAIL: pending user inserted a task';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS: pending user cannot create tasks';
end $$;
-- 3. Students cannot change their own permissions
do $$ begin
  update public.profiles set status = 'approved' where id = auth.uid();
  if exists (select 1 from public.profiles where id = auth.uid() and status = 'approved') then
    raise exception 'FAIL: pending user self-approved';
  end if;
  raise notice 'PASS: pending user cannot self-approve (0 rows updated)';
exception when insufficient_privilege then raise notice 'PASS: pending user cannot self-approve (%)', sqlerrm;
end $$;
do $$ begin
  perform public.admin_set_status(auth.uid(), 'approved');
  raise exception 'FAIL: student called admin_set_status';
exception when insufficient_privilege then raise notice 'PASS: student cannot call admin_set_status';
end $$;
do $$ begin
  perform public.admin_stats();
  raise exception 'FAIL: student read admin stats';
exception when insufficient_privilege then raise notice 'PASS: student cannot read admin stats';
end $$;

-- ---------------------------------------------------------------- 2. admin approves / rejects
select pg_temp.act_as('ckm25.dz@gmail.com');
select pg_temp.ok((select count(*) >= 4 from public.profiles), 'Admin sees all registrations');
select pg_temp.ok((select (public.admin_stats() ->> 'pending')::int = 3), 'Admin stats: 3 pending (admin not counted)');
select public.admin_set_status((select id from public.profiles where email = 'alice@test.local'), 'approved');
select public.admin_set_status((select id from public.profiles where email = 'bob@test.local'), 'approved');
select public.admin_set_status((select id from public.profiles where email = 'carol@test.local'), 'rejected');
select pg_temp.ok((select (public.admin_stats() ->> 'approved')::int = 2 and (public.admin_stats() ->> 'rejected')::int = 1),
                  'Admin stats reflect approve/reject');
do $$ begin
  perform public.admin_set_status((select id from public.profiles where email = 'alice@test.local'), 'rejected');
  raise exception 'FAIL: invalid transition approved->rejected accepted';
exception when invalid_parameter_value then raise notice 'PASS: invalid status transition refused';
end $$;
do $$ begin
  perform public.admin_set_status(auth.uid(), 'suspended');
  raise exception 'FAIL: admin suspended self';
exception when insufficient_privilege then raise notice 'PASS: admin cannot change own status';
end $$;
do $$ begin
  update public.profiles set role = 'admin' where email = 'bob@test.local';
  raise exception 'FAIL: direct role update allowed';
exception when insufficient_privilege then raise notice 'PASS: even admin cannot change roles through the API (%)', sqlerrm;
end $$;
select pg_temp.ok((select count(*) = 3 from public.admin_audit_log), 'Admin decisions are audit-logged');

-- rejected user: no data access
select pg_temp.act_as('carol@test.local');
select pg_temp.ok((select count(*) = 0 from public.modules), 'Rejected user sees no modules');
select pg_temp.ok((select status = 'rejected' from public.profiles where id = auth.uid()), 'Rejected user can read own status (to show the right page)');

-- ---------------------------------------------------------------- approved student: progress
select pg_temp.act_as('alice@test.local');
select pg_temp.ok((select count(*) = 35 from public.modules where year = 1) and (select count(*) = 27 from public.modules where year = 2), 'Approved student sees all active modules (35 in Year 1, 27 in Year 2)');
select pg_temp.ok((select count(*) = 160 + 187 from public.lessons), 'Approved student sees 160 + 187 active lessons (inactive placeholder hidden)');
do $$ begin
  update public.profiles set role = 'admin' where id = auth.uid();
  raise exception 'FAIL: student changed role';
exception when insufficient_privilege then raise notice 'PASS: approved student cannot change own role';
end $$;
update public.profiles set display_name = 'Alice', selected_year = 1, selected_semester = 'S2' where id = auth.uid();
select pg_temp.ok((select display_name = 'Alice' and selected_semester = 'S2' from public.profiles where id = auth.uid()),
                  'Student can save display name and selected year/semester');
do $$ begin
  insert into public.modules (title) values ('hack');
  raise exception 'FAIL: student created a module';
exception when insufficient_privilege then raise notice 'PASS: student cannot create modules';
end $$;

-- 5. complete 4 of the 10 lessons of "Les lipides" (S2 Biochimie) => 40 %
create temp table lip as select l.id, l.position from public.lessons l join public.modules m on m.id = l.module_id
  where m.title = 'Les lipides' order by l.position;
select pg_temp.ok((select count(*) = 10 from lip), '"Les lipides" has 10 lessons (from the PDF)');
select public.set_lesson_stage(id, 'learned', true) from lip where position <= 4;
select pg_temp.ok(pg_temp.progress((select id from public.modules where title = 'Les lipides'), auth.uid()) = 40.0,
                  'T5 4 of 10 lessons learned => 40%');
-- duplicate completion is impossible
select public.set_lesson_stage(id, 'learned', true) from lip where position = 1;
select pg_temp.ok((select count(*) = 4 from public.lesson_progress where user_id = auth.uid()), 'Re-completing a lesson creates no duplicate row');
do $$ begin
  insert into public.lesson_progress (user_id, lesson_id, learned) select auth.uid(), id, true from lip where position = 1;
  raise exception 'FAIL: duplicate row inserted';
exception when unique_violation then raise notice 'PASS: primary key forbids duplicate completion records';
end $$;
-- other stages never reset 'learned'
select public.set_lesson_stage(id, 'revised1', true) from lip where position = 1;
select public.set_lesson_stage(id, 'qcm', true) from lip where position = 1;
select pg_temp.ok((select learned and revised1 and qcm and not revised2 from public.lesson_progress lp join lip on lip.id = lp.lesson_id
                    where lip.position = 1 and lp.user_id = auth.uid()), 'Setting one stage leaves the other stages untouched');
-- 9. complete another => 50 %
select public.set_lesson_stage(id, 'learned', true) from lip where position = 5;
select pg_temp.ok(pg_temp.progress((select id from public.modules where title = 'Les lipides'), auth.uid()) = 50.0, 'T9 5th lesson => 50%');
-- 10. reopen one => 40 %
select public.set_lesson_stage(id, 'learned', false) from lip where position = 2;
select pg_temp.ok(pg_temp.progress((select id from public.modules where title = 'Les lipides'), auth.uid()) = 40.0, 'T10 reopening a lesson => 40%');
select pg_temp.ok((select learned_at is null from public.lesson_progress lp join lip on lip.id = lp.lesson_id
                    where lip.position = 2 and lp.user_id = auth.uid()), 'Reopened lesson clears its completion date');
-- 11. independence
select pg_temp.ok(pg_temp.progress((select id from public.modules where title = 'Les enzymes'), auth.uid()) = 0.0,
                  'T11 sibling module "Les enzymes" stays at 0%');
select pg_temp.ok(pg_temp.progress((select id from public.modules where title = 'Biochimie' and semester = 'S2'), auth.uid())
                    = round(100.0 * 4 / 15, 1), 'Parent "Biochimie S2" aggregates its chapters (4/15 lessons)');
-- empty module
select pg_temp.ok(pg_temp.progress((select id from public.modules where title = 'Généralités' and semester = 'S2'), auth.uid()) is null,
                  'Module without lessons has no percentage (empty state, not 0%)');

-- planner + weekly notes
insert into public.planner_tasks (user_id, title, task_date, category, priority) values
  (auth.uid(), 'Revoir lipides', date '2026-10-26', 'revision', 'high'),
  (auth.uid(), 'QCM enzymes', date '2026-10-19', 'qcm', 'medium');
select public.save_weekly_notes(date '2026-10-26', '{"goals":"Finir les lipides"}', 0);
select public.save_weekly_notes(date '2026-10-19', '{"goals":"Semaine passée"}', 0);
do $$ begin
  perform public.save_weekly_notes(date '2026-10-26', '{"goals":"écrasement"}', 0);
  raise exception 'FAIL: stale write accepted';
exception when raise_exception then
  if sqlerrm <> 'version_conflict' then raise; end if;
  raise notice 'PASS: stale weekly-notes write refused (version_conflict), no silent overwrite';
end $$;
select public.save_weekly_notes(date '2026-10-26', '{"reminders":"Tu vas y arriver"}', 1);
select pg_temp.ok((select goals = 'Finir les lipides' and reminders = 'Tu vas y arriver' and version = 2
                     from public.weekly_notes where week_start = '2026-10-26'), 'Partial weekly-notes save keeps other fields');
do $$ begin
  perform public.save_weekly_notes(date '2026-10-28', '{}', 0);
  raise exception 'FAIL: non-Monday week accepted';
exception when check_violation then raise notice 'PASS: week identifier must be a Monday';
end $$;

-- global notes with optimistic versioning
insert into public.notes (user_id, title, content) values (auth.uid(), 'Cycle de Krebs', 'v1');
update public.notes set content = 'v2' where user_id = auth.uid() and title = 'Cycle de Krebs' and version = 1;
select pg_temp.ok((select version = 2 from public.notes where title = 'Cycle de Krebs'), 'Note version increments on edit');
do $$ declare n int; begin
  update public.notes set content = 'stale' where title = 'Cycle de Krebs' and version = 1; get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'Stale note update (old version) changes nothing'); end $$;

-- ---------------------------------------------------------------- 4. cross-user isolation
select pg_temp.act_as('bob@test.local');
select pg_temp.ok((select count(*) = 0 from public.lesson_progress), 'T4 Bob cannot read Alice''s progress');
select pg_temp.ok((select count(*) = 0 from public.planner_tasks), 'T4 Bob cannot read Alice''s tasks');
select pg_temp.ok((select count(*) = 0 from public.weekly_notes), 'T4 Bob cannot read Alice''s weekly notes');
select pg_temp.ok((select count(*) = 0 from public.notes), 'T4 Bob cannot read Alice''s notes');
select pg_temp.ok((select count(*) = 1 from public.profiles), 'T4 Bob sees only his own profile');
do $$ declare n int; begin
  update public.notes set content = 'pwned'; get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'T4 Bob cannot modify Alice''s notes'); end $$;
do $$ declare n int; begin
  delete from public.planner_tasks; get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'T4 Bob cannot delete Alice''s tasks'); end $$;
do $$ begin
  insert into public.planner_tasks (user_id, title, task_date)
  values ((select id from auth.users where email = 'alice@test.local'), 'injected', current_date);
  raise exception 'FAIL: Bob wrote into Alice''s planner';
exception when insufficient_privilege then raise notice 'PASS: T4 Bob cannot insert rows for Alice';
end $$;
do $$ begin
  insert into public.study_sessions (id, user_id, planned_seconds, active_seconds, started_at, ended_at, status)
  values (gen_random_uuid(), auth.uid(), 1500, 1500, now(), now(), 'completed');
  raise exception 'FAIL: forged study session';
exception when insufficient_privilege then raise notice 'PASS: study history cannot be forged from the client';
end $$;

-- ---------------------------------------------------------------- 6/7/8. persistence: a "new login" is just a new JWT
reset role; select set_config('request.jwt.claims', '', false);
set role authenticated;
select pg_temp.act_as('alice@test.local');
select pg_temp.ok(pg_temp.progress((select id from public.modules where title = 'Les lipides'), auth.uid()) = 40.0,
                  'T6/T7/T8 a fresh session (logout/login, refresh, other device) still reads 40%');
select pg_temp.ok((select count(*) = 2 from public.planner_tasks), 'T12 planner tasks persist across sessions');
select pg_temp.ok((select count(*) = 2 from public.weekly_notes), 'T13 previous weeks remain accessible');

-- ---------------------------------------------------------------- suspension: immediate revocation
reset role;
insert into auth.sessions (user_id) select id from auth.users where email = 'alice@test.local';
set role authenticated;
select pg_temp.act_as('ckm25.dz@gmail.com');
select public.admin_set_status((select id from public.profiles where email = 'alice@test.local'), 'suspended');
select pg_temp.act_as('alice@test.local');
select pg_temp.ok((select count(*) = 0 from public.lesson_progress), 'Suspended user immediately loses data access (same JWT)');
select pg_temp.ok((select count(*) = 0 from public.modules), 'Suspended user sees no modules');
reset role;
select pg_temp.ok((select count(*) = 0 from auth.sessions s join auth.users u on u.id = s.user_id where u.email = 'alice@test.local'),
                  'Suspension deletes the user''s auth sessions (refresh tokens die)');
select pg_temp.ok((select count(*) filter (where learned) = 4 and count(*) = 5 from public.lesson_progress lp join auth.users u on u.id = lp.user_id where u.email = 'alice@test.local'),
                  'Suspension does NOT delete the student''s data');
set role authenticated;
select pg_temp.act_as('ckm25.dz@gmail.com');
select public.admin_set_status((select id from public.profiles where email = 'alice@test.local'), 'approved');
select pg_temp.act_as('alice@test.local');
select pg_temp.ok(pg_temp.progress((select id from public.modules where title = 'Les lipides'), auth.uid()) = 40.0,
                  'Reactivated student finds her 40% intact');

-- ---------------------------------------------------------------- admin curriculum management
select pg_temp.act_as('ckm25.dz@gmail.com');
insert into public.lessons (module_id, title, position)
  select id, 'Leçon ajoutée par l''admin', 11 from public.modules where title = 'Les lipides';
select pg_temp.act_as('alice@test.local');
select pg_temp.ok(pg_temp.progress((select id from public.modules where title = 'Les lipides'), auth.uid()) = round(100.0 * 4 / 11, 1),
                  'Admin adds a lesson => percentage recomputed from real records (4/11)');
reset role;
\o
select 'ALL DATABASE TESTS PASSED';
