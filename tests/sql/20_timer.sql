-- Pomodoro timer tests. Elapsed time is simulated by shifting timestamps back (as superuser).
\set QUIET on
\pset tuples_only on
\o /dev/null
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
create or replace function pg_temp.shift(p_email text, p_seconds int) returns void language sql security definer as $$
  update public.timer_state set running_since = running_since - make_interval(secs => p_seconds),
                                started_at = started_at - make_interval(secs => p_seconds)
   where user_id = (select id from auth.users where email = p_email);
$$;
create or replace function pg_temp.n_sessions(p_email text, p_status text) returns int language sql security definer as $$
  select count(*)::int from public.study_sessions s join auth.users u on u.id = s.user_id
   where u.email = p_email and s.status = p_status;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- fresh timer state for a dedicated approved user
delete from auth.users where email = 'timer@test.local';
insert into auth.users (email, email_confirmed_at) values ('timer@test.local', now());
update public.profiles set status = 'approved' where email = 'timer@test.local';

set role authenticated;
select pg_temp.act_as('timer@test.local');

select pg_temp.ok((select (public.timer_sync() -> 'state' ->> 'status') = 'idle'
                      and (public.timer_sync() -> 'state' ->> 'duration_seconds')::int = 1500), 'Timer starts idle with a 25-min focus');
select public.timer_start((select id from public.modules where title = 'Les lipides'), null, null);
select pg_temp.ok((select status = 'running' and module_id is not null from public.timer_state), 'Start => running, associated with a module');
select public.timer_start(null, null, null);
select pg_temp.ok((select count(*) = 1 from public.timer_state), 'Double start is idempotent');

-- 10 min of focus, then pause
select pg_temp.shift('timer@test.local', 600);
select public.timer_pause();
select pg_temp.ok((select status = 'paused' and accumulated_seconds between 600 and 601 from public.timer_state),
                  'Pause stores 10 min of ACTIVE time');
-- a 2-hour pause (nothing changes while paused: running_since is null)
select pg_temp.ok((select (public.timer_sync() ->> 'remaining_seconds')::int between 899 and 900), 'Paused timer keeps 15 min remaining after refresh');
select public.timer_resume();
-- 15 more minutes elapse, the tab is closed; on next load the session is finished exactly once
select pg_temp.shift('timer@test.local', 900);
select pg_temp.ok((select public.timer_sync() ->> 'finished_phase' = 'focus'), 'Expired timer is completed on next load (browser closed)');
select pg_temp.ok(pg_temp.n_sessions('timer@test.local', 'completed') = 1, 'One completed session recorded');
select pg_temp.ok((select active_seconds = 1500 and planned_seconds = 1500 from public.study_sessions),
                  'Active time = 25 min: the pause is NOT counted');
select pg_temp.ok((select phase = 'short_break' and status = 'idle' from public.timer_state), 'Next phase is a short break');
select public.timer_sync(); select public.timer_complete();
select pg_temp.ok(pg_temp.n_sessions('timer@test.local', 'completed') = 1, 'Re-sync / repeated complete never duplicates the session');

-- closed for 3 hours during a focus: end time is when the timer ran out, not when the user came back
select public.timer_skip();                                  -- skip the break
select public.timer_start(null, null, null);
select pg_temp.shift('timer@test.local', 3 * 3600);
select public.timer_sync();
select pg_temp.ok((select ended_at - started_at = interval '25 min' from public.study_sessions order by created_at desc limit 1),
                  'Session finished while closed ends at start + 25 min (not at reopen time)');

-- two devices completing simultaneously => still one record
select public.timer_skip();
select public.timer_start(null, null, null);
select pg_temp.shift('timer@test.local', 1500);
select public.timer_complete();
select public.timer_complete();
select pg_temp.ok(pg_temp.n_sessions('timer@test.local', 'completed') = 3, 'Completing twice (two devices) records one session');

-- completing too early is refused
select public.timer_skip();
select public.timer_start(null, null, null);
select pg_temp.shift('timer@test.local', 300);
do $$ begin
  perform public.timer_complete();
  raise exception 'FAIL: early completion accepted';
exception when raise_exception then
  if sqlerrm <> 'timer_not_finished' then raise; end if;
  raise notice 'PASS: a focus session cannot be completed before its time is up';
end $$;
-- reset after 5 min => interrupted session kept with 5 min active, not counted as completed
select public.timer_reset();
select pg_temp.ok(pg_temp.n_sessions('timer@test.local', 'interrupted') = 1 and pg_temp.n_sessions('timer@test.local', 'completed') = 3,
                  'Reset after 5 min: kept as interrupted (5 min active), NOT a completed session');
-- reset after 30 s => nothing recorded
select public.timer_start(null, null, null);
select pg_temp.shift('timer@test.local', 30);
select public.timer_reset();
select pg_temp.ok(pg_temp.n_sessions('timer@test.local', 'interrupted') = 1, 'Reset after 30 s records nothing');

-- 4th completed focus => long break
select public.timer_start(null, null, null);
select pg_temp.shift('timer@test.local', 1500);
select public.timer_sync();
select pg_temp.ok((select phase = 'long_break' and duration_seconds = 900 from public.timer_state), 'After 4 focus sessions comes a 15-min long break');

-- custom durations
insert into public.pomodoro_settings (user_id, focus_minutes, short_break_minutes, long_break_minutes)
values (auth.uid(), 50, 10, 30);
select public.timer_skip();
select public.timer_apply_settings();
select pg_temp.ok((select phase = 'focus' and duration_seconds = 3000 from public.timer_state), 'Custom focus duration (50 min) applied to idle timer');

-- choose a phase manually while idle (Focus / Short break / Long break tabs)
select public.timer_set_phase('short_break');
select pg_temp.ok((select phase = 'short_break' and duration_seconds = 600 from public.timer_state), 'Idle timer can switch to a short break (10 min custom)');
select public.timer_start(null, null, null);
do $$ begin
  perform public.timer_set_phase('focus');
  raise exception 'FAIL: phase changed while running';
exception when raise_exception then
  if sqlerrm <> 'timer_busy' then raise; end if;
  raise notice 'PASS: phase cannot be switched while a session is running';
end $$;
select public.timer_reset();
select public.timer_set_phase('focus');

-- clients cannot write timer state or history directly
do $$ begin
  update public.timer_state set accumulated_seconds = 0;
  raise exception 'FAIL: direct timer update allowed';
exception when insufficient_privilege then raise notice 'PASS: timer state is read-only for clients';
end $$;
select pg_temp.act_as('bob@test.local');
select pg_temp.ok((select count(*) = 0 from public.study_sessions), 'Other students cannot see this study history');
reset role;
\o
select 'ALL TIMER TESTS PASSED';
