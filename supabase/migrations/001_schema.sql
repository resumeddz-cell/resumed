-- =====================================================================
-- Resumed Study Tracker — database schema, security (RLS) and server logic
-- Target: Supabase (PostgreSQL 15+). Run once in the Supabase SQL editor,
-- or with `supabase db push`. Re-running is safe (idempotent where possible).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Private configuration (no client access: RLS on, zero policies)
-- ---------------------------------------------------------------------
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;
-- (no policies => invisible to anon/authenticated; only SECURITY DEFINER code reads it)

-- Initial administrator. Change here ONLY if the admin e-mail changes.
-- The account becomes admin only once this e-mail address is CONFIRMED (see §3).
insert into public.app_config (key, value)
values ('initial_admin_email', 'ckm25.dz@gmail.com')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Profiles (roles + approval workflow)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null,
  display_name       text check (display_name is null or char_length(display_name) <= 80),
  role               text not null default 'student' check (role in ('admin', 'student')),
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected', 'suspended')),
  selected_year      smallint check (selected_year between 1 and 7),
  selected_semester  text check (selected_semester in ('S1', 'S2')),
  status_changed_at  timestamptz,
  status_changed_by  uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists profiles_email_lower_uq on public.profiles (lower(email));
create index if not exists profiles_status_created_idx on public.profiles (status, created_at desc);

-- Helper predicates. SECURITY DEFINER so they can read profiles regardless of RLS.
-- They are evaluated on EVERY query, so a suspension takes effect immediately.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'approved');
$$;

-- Guard: API callers (role authenticated/anon) can never change role, status, e-mail,
-- id or audit columns of a profile — not their own, and not even an admin's, through
-- direct table writes. Status changes go exclusively through admin_set_status() below
-- (SECURITY DEFINER => runs as the function owner, so this guard lets it through).
create or replace function public.profiles_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.status_changed_at is distinct from old.status_changed_at
       or new.status_changed_by is distinct from old.status_changed_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Not allowed to modify protected profile fields' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
  for each row execute function public.profiles_guard();

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own   on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_update_own   on public.profiles;
-- Everyone (incl. pending/rejected/suspended) can read THEIR OWN row, so the app can
-- show the correct "awaiting approval / suspended" page.
create policy profiles_select_own   on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_select_admin on public.profiles for select to authenticated
  using (public.is_admin());
-- Only approved users may edit their own row, and the guard trigger limits WHAT they can edit
-- (display_name, selected_year, selected_semester).
create policy profiles_update_own   on public.profiles for update to authenticated
  using (id = auth.uid() and status = 'approved')
  with check (id = auth.uid());
-- No INSERT policy (rows are created by the signup trigger), no DELETE policy.

-- ---------------------------------------------------------------------
-- 2. Audit log of administrator decisions
-- ---------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references auth.users (id) on delete set null,
  target_id   uuid references auth.users (id) on delete set null,
  target_email text,
  action      text not null,
  old_status  text,
  new_status  text,
  created_at  timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
drop policy if exists audit_select_admin on public.admin_audit_log;
create policy audit_select_admin on public.admin_audit_log for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- 3. Signup trigger + secure initial-admin provisioning
-- ---------------------------------------------------------------------
-- Shared promotion rule: the configured admin e-mail becomes admin/approved ONLY once that
-- e-mail address has been CONFIRMED (email_confirmed_at set). Nobody can squat the admin address
-- by registering it first: an unconfirmed signup stays a pending student.
-- IMPORTANT: keep "Confirm email" ENABLED in Supabase Auth settings.
create or replace function public._promote_if_initial_admin(p_id uuid, p_email text, p_confirmed timestamptz)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare admin_email text;
begin
  select lower(value) into admin_email from public.app_config where key = 'initial_admin_email';
  if admin_email is not null and lower(p_email) = admin_email and p_confirmed is not null then
    update public.profiles
       set role = 'admin', status = 'approved', status_changed_at = now()
     where id = p_id and (role <> 'admin' or status <> 'approved');
  end if;
end $$;

-- Every new auth user gets a 'pending' student profile (then the admin rule above is applied).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  perform public._promote_if_initial_admin(new.id, new.email, new.email_confirmed_at);
  return new;
end $$;

create or replace function public.sync_initial_admin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._promote_if_initial_admin(new.id, new.email, new.email_confirmed_at);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public.sync_initial_admin();

-- Back-fill: profiles for users that already existed before this migration, and promotion
-- of the admin if the account already exists and is confirmed.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

update public.profiles p
   set role = 'admin', status = 'approved', status_changed_at = now()
  from auth.users u, public.app_config c
 where c.key = 'initial_admin_email'
   and p.id = u.id and lower(u.email) = lower(c.value)
   and u.email_confirmed_at is not null
   and (p.role <> 'admin' or p.status <> 'approved');

-- ---------------------------------------------------------------------
-- 4. Admin operations (the ONLY way to change an account status)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_status(p_user uuid, p_status text) returns public.profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.profiles; old_status text;
begin
  if not public.is_admin() then
    raise exception 'Administrator only' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected', 'suspended') then
    raise exception 'Invalid status %', p_status using errcode = '22023';
  end if;
  select * into t from public.profiles where id = p_user for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if t.id = auth.uid() then raise exception 'You cannot change your own status' using errcode = '42501'; end if;
  if t.role = 'admin' then raise exception 'Administrator accounts cannot be changed here' using errcode = '42501'; end if;
  old_status := t.status;
  -- allowed transitions: pending->approved|rejected, rejected->approved,
  --                      approved->suspended,        suspended->approved (reactivate)
  if not ((old_status = 'pending'   and p_status in ('approved', 'rejected'))
       or (old_status = 'rejected'  and p_status = 'approved')
       or (old_status = 'approved'  and p_status = 'suspended')
       or (old_status = 'suspended' and p_status = 'approved')) then
    raise exception 'Transition % -> % is not allowed', old_status, p_status using errcode = '22023';
  end if;
  update public.profiles
     set status = p_status, status_changed_at = now(), status_changed_by = auth.uid()
   where id = p_user returning * into t;
  insert into public.admin_audit_log (admin_id, target_id, target_email, action, old_status, new_status)
  values (auth.uid(), p_user, t.email, 'set_status', old_status, p_status);
  -- Revoke access immediately: kill refresh tokens/sessions. (Data access is ALSO cut instantly by RLS.)
  if p_status in ('rejected', 'suspended') then
    begin
      delete from auth.sessions where user_id = p_user;
    exception when insufficient_privilege or undefined_table then
      -- Not permitted on this platform: access is still cut off immediately by RLS (is_approved()),
      -- and the remaining access token expires on its own (JWT expiry, 1 h by default).
      null;
    end;
  end if;
  return t;
end $$;

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator only' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
      'total',     count(*),
      'pending',   count(*) filter (where status = 'pending'),
      'approved',  count(*) filter (where status = 'approved'),
      'rejected',  count(*) filter (where status = 'rejected'),
      'suspended', count(*) filter (where status = 'suspended'))
    from public.profiles where role = 'student');
end $$;

-- ---------------------------------------------------------------------
-- 5. Curriculum: modules (tree) and lessons — managed by the admin, no code changes
-- ---------------------------------------------------------------------
create table if not exists public.modules (
  id           uuid primary key default gen_random_uuid(),
  year         smallint not null default 1 check (year between 1 and 7),
  semester     text check (semester in ('S1', 'S2')),
  parent_id    uuid references public.modules (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  description  text check (description is null or char_length(description) <= 2000),
  icon         text,             -- path of an asset cropped from the source PDF
  hero         text,             -- header illustration cropped from the source PDF
  source_page  smallint,         -- PDF page the structure was transcribed from
  position     integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index if not exists modules_parent_idx on public.modules (parent_id, position);
create index if not exists modules_year_sem_idx on public.modules (year, semester, position) where parent_id is null;

create table if not exists public.lessons (
  id          uuid primary key default gen_random_uuid(),
  module_id   uuid not null references public.modules (id) on delete cascade,
  number      text,              -- label as printed in the PDF (e.g. '01', '02')
  title       text not null check (char_length(title) between 1 and 300),
  icon        text,
  note        text check (note is null or char_length(note) <= 2000),
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists lessons_module_idx on public.lessons (module_id, position);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists modules_touch on public.modules;
create trigger modules_touch before update on public.modules for each row execute function public.touch_updated_at();
drop trigger if exists lessons_touch on public.lessons;
create trigger lessons_touch before update on public.lessons for each row execute function public.touch_updated_at();

-- Forbid cycles in the module tree and limit depth to 4 levels.
create or replace function public.modules_tree_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare cur uuid := new.parent_id; depth int := 1;
begin
  while cur is not null loop
    if cur = new.id then raise exception 'Module cannot be its own ancestor' using errcode = '23514'; end if;
    depth := depth + 1;
    if depth > 4 then raise exception 'Module tree too deep' using errcode = '23514'; end if;
    select parent_id into cur from public.modules where id = cur;
  end loop;
  return new;
end $$;
drop trigger if exists modules_tree_guard_trg on public.modules;
create trigger modules_tree_guard_trg before insert or update of parent_id on public.modules
  for each row execute function public.modules_tree_guard();

alter table public.modules enable row level security;
alter table public.lessons enable row level security;
drop policy if exists modules_read  on public.modules;
drop policy if exists modules_admin on public.modules;
drop policy if exists lessons_read  on public.lessons;
drop policy if exists lessons_admin on public.lessons;
create policy modules_read  on public.modules for select to authenticated
  using (public.is_approved() and (active or public.is_admin()));
create policy modules_admin on public.modules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy lessons_read  on public.lessons for select to authenticated
  using (public.is_approved() and (active or public.is_admin()));
create policy lessons_admin on public.lessons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_reorder_modules(p_ids uuid[]) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Administrator only' using errcode = '42501'; end if;
  update public.modules m set position = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord) where m.id = o.id;
end $$;

create or replace function public.admin_reorder_lessons(p_ids uuid[]) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Administrator only' using errcode = '42501'; end if;
  update public.lessons l set position = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord) where l.id = o.id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Lesson progress — one row per (user, lesson); progress is ALWAYS derived from these rows
-- ---------------------------------------------------------------------
create table if not exists public.lesson_progress (
  user_id      uuid not null references auth.users (id) on delete cascade,
  lesson_id    uuid not null references public.lessons (id) on delete cascade,
  learned      boolean not null default false,   -- "Learned / Appris"  => the lesson counts as COMPLETED
  revised1     boolean not null default false,   -- "Revised 1 / Révisé 1"
  revised2     boolean not null default false,   -- "Revised 2 / Révisé 2"
  qcm          boolean not null default false,   -- "QCM"
  learned_at   timestamptz,
  revised1_at  timestamptz,
  revised2_at  timestamptz,
  qcm_at       timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, lesson_id)               -- => no duplicate completion records, ever
);
create index if not exists lesson_progress_lesson_idx on public.lesson_progress (lesson_id);
create index if not exists lesson_progress_user_learned_idx on public.lesson_progress (user_id, learned_at) where learned;

alter table public.lesson_progress enable row level security;
drop policy if exists lesson_progress_own on public.lesson_progress;
create policy lesson_progress_own on public.lesson_progress for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

-- Atomic, partial update of ONE stage. Never touches the other stages, never resets anything.
create or replace function public.set_lesson_stage(p_lesson uuid, p_stage text, p_value boolean)
returns public.lesson_progress
language plpgsql set search_path = public, pg_temp as $$
declare r public.lesson_progress;
begin
  if p_stage not in ('learned', 'revised1', 'revised2', 'qcm') then
    raise exception 'Unknown stage %', p_stage using errcode = '22023';
  end if;
  if not public.is_approved() then raise exception 'Account not approved' using errcode = '42501'; end if;
  if not exists (select 1 from public.lessons where id = p_lesson and active) then
    raise exception 'Lesson not found' using errcode = 'P0002';
  end if;
  execute format(
    'insert into public.lesson_progress (user_id, lesson_id, %1$I, %1$I_at)
       values ($1, $2, $3, case when $3 then now() end)
     on conflict (user_id, lesson_id) do update
       set %1$I = excluded.%1$I,
           %1$I_at = case when excluded.%1$I then coalesce(public.lesson_progress.%1$I_at, now()) else null end,
           updated_at = now()
     returning *', p_stage)
  into r using auth.uid(), p_lesson, p_value;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 7. Weekly planner: tasks + weekly notes
-- ---------------------------------------------------------------------
create table if not exists public.planner_tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  description  text check (description is null or char_length(description) <= 5000),
  task_date    date not null,
  start_time   time,
  end_time     time,
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  category     text not null default 'other'
                 check (category in ('lectures', 'revision', 'qcm', 'practical', 'personal', 'other')),
  status       text not null default 'todo' check (status in ('todo', 'done')),
  completed_at timestamptz,
  notes        text check (notes is null or char_length(notes) <= 5000),
  module_id    uuid references public.modules (id) on delete set null,
  lesson_id    uuid references public.lessons (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time),
  unique (id, user_id)
);
create index if not exists planner_tasks_user_date_idx on public.planner_tasks (user_id, task_date);

create or replace function public.planner_tasks_biu() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then now() else null end;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists planner_tasks_biu_trg on public.planner_tasks;
create trigger planner_tasks_biu_trg before insert or update on public.planner_tasks
  for each row execute function public.planner_tasks_biu();

alter table public.planner_tasks enable row level security;
drop policy if exists planner_tasks_own on public.planner_tasks;
create policy planner_tasks_own on public.planner_tasks for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

-- One row per (student, week). week_start is the Monday of that week. Old weeks are never touched.
create table if not exists public.weekly_notes (
  user_id        uuid not null references auth.users (id) on delete cascade,
  week_start     date not null check (extract(isodow from week_start) = 1),
  goals          text not null default '' check (char_length(goals) <= 50000),
  reminders      text not null default '' check (char_length(reminders) <= 50000),
  study_notes    text not null default '' check (char_length(study_notes) <= 50000),
  review_topics  text not null default '' check (char_length(review_topics) <= 50000),
  planning_notes text not null default '' check (char_length(planning_notes) <= 50000),
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table public.weekly_notes enable row level security;
drop policy if exists weekly_notes_own on public.weekly_notes;
create policy weekly_notes_own on public.weekly_notes for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

-- Optimistic-concurrency save: refuses to overwrite a newer version written from another device.
-- p_expected_version = 0 means "I believe no row exists yet for this week".
create or replace function public.save_weekly_notes(p_week date, p_notes jsonb, p_expected_version integer)
returns public.weekly_notes
language plpgsql set search_path = public, pg_temp as $$
declare r public.weekly_notes;
begin
  if not public.is_approved() then raise exception 'Account not approved' using errcode = '42501'; end if;
  if p_expected_version = 0 then
    insert into public.weekly_notes (user_id, week_start, goals, reminders, study_notes, review_topics, planning_notes)
    values (auth.uid(), p_week,
            coalesce(p_notes ->> 'goals', ''), coalesce(p_notes ->> 'reminders', ''),
            coalesce(p_notes ->> 'study_notes', ''), coalesce(p_notes ->> 'review_topics', ''),
            coalesce(p_notes ->> 'planning_notes', ''))
    on conflict (user_id, week_start) do nothing
    returning * into r;
  else
    update public.weekly_notes
       set goals = coalesce(p_notes ->> 'goals', goals),
           reminders = coalesce(p_notes ->> 'reminders', reminders),
           study_notes = coalesce(p_notes ->> 'study_notes', study_notes),
           review_topics = coalesce(p_notes ->> 'review_topics', review_topics),
           planning_notes = coalesce(p_notes ->> 'planning_notes', planning_notes),
           version = version + 1, updated_at = now()
     where user_id = auth.uid() and week_start = p_week and version = p_expected_version
    returning * into r;
  end if;
  if r.user_id is null then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 8. Global notes
-- ---------------------------------------------------------------------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default '' check (char_length(title) <= 300),
  content     text not null default '' check (char_length(content) <= 200000),
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);

create or replace function public.notes_bu() returns trigger
language plpgsql as $$
begin
  if new.title is distinct from old.title or new.content is distinct from old.content then
    new.version := old.version + 1;
    new.updated_at := now();
  else
    new.version := old.version; new.updated_at := old.updated_at;
  end if;
  new.id := old.id; new.user_id := old.user_id; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists notes_bu_trg on public.notes;
create trigger notes_bu_trg before update on public.notes for each row execute function public.notes_bu();

alter table public.notes enable row level security;
drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

-- ---------------------------------------------------------------------
-- 9. Settings and preferences
-- ---------------------------------------------------------------------
create table if not exists public.pomodoro_settings (
  user_id                    uuid primary key references auth.users (id) on delete cascade,
  focus_minutes              smallint not null default 25 check (focus_minutes between 1 and 180),
  short_break_minutes        smallint not null default 5  check (short_break_minutes between 1 and 60),
  long_break_minutes         smallint not null default 15 check (long_break_minutes between 1 and 120),
  sessions_before_long_break smallint not null default 4  check (sessions_before_long_break between 2 and 12),
  sound_enabled              boolean  not null default true,
  updated_at                 timestamptz not null default now()
);
alter table public.pomodoro_settings enable row level security;
drop policy if exists pomodoro_settings_own on public.pomodoro_settings;
create policy pomodoro_settings_own on public.pomodoro_settings for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

create table if not exists public.user_preferences (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  language    text not null default 'en' check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  data        jsonb not null default '{}'::jsonb check (pg_column_size(data) < 16384),
  updated_at  timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

-- ---------------------------------------------------------------------
-- 10. Study sessions (history) — written ONLY by the timer functions below
-- ---------------------------------------------------------------------
create table if not exists public.study_sessions (
  id              uuid primary key,          -- = timer session id => the same session can never be stored twice
  user_id         uuid not null references auth.users (id) on delete cascade,
  module_id       uuid references public.modules (id) on delete set null,
  lesson_id       uuid references public.lessons (id) on delete set null,
  task_id         uuid,
  planned_seconds integer not null check (planned_seconds > 0),
  active_seconds  integer not null check (active_seconds >= 0),   -- paused time is NOT included
  started_at      timestamptz not null,
  ended_at        timestamptz not null,
  status          text not null check (status in ('completed', 'interrupted')),
  created_at      timestamptz not null default now(),
  foreign key (task_id, user_id) references public.planner_tasks (id, user_id) on delete set null (task_id)
);
create index if not exists study_sessions_user_started_idx on public.study_sessions (user_id, started_at desc);

alter table public.study_sessions enable row level security;
drop policy if exists study_sessions_select on public.study_sessions;
drop policy if exists study_sessions_delete on public.study_sessions;
create policy study_sessions_select on public.study_sessions for select to authenticated
  using (user_id = auth.uid() and public.is_approved());
create policy study_sessions_delete on public.study_sessions for delete to authenticated
  using (user_id = auth.uid() and public.is_approved());
-- No INSERT/UPDATE policy: history cannot be forged or edited from the client.

-- ---------------------------------------------------------------------
-- 11. Pomodoro timer: server-side state machine based on timestamps
-- ---------------------------------------------------------------------
create table if not exists public.timer_state (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  session_id         uuid not null default gen_random_uuid(),
  phase              text not null default 'focus' check (phase in ('focus', 'short_break', 'long_break')),
  status             text not null default 'idle' check (status in ('idle', 'running', 'paused')),
  duration_seconds   integer not null default 1500 check (duration_seconds between 60 and 14400),
  accumulated_seconds integer not null default 0 check (accumulated_seconds >= 0),
  running_since      timestamptz,
  started_at         timestamptz,
  module_id          uuid references public.modules (id) on delete set null,
  lesson_id          uuid references public.lessons (id) on delete set null,
  task_id            uuid,
  focus_in_cycle     smallint not null default 0 check (focus_in_cycle >= 0),
  updated_at         timestamptz not null default now(),
  check ((status = 'running') = (running_since is not null)),
  foreign key (task_id, user_id) references public.planner_tasks (id, user_id) on delete set null (task_id)
);
alter table public.timer_state enable row level security;
drop policy if exists timer_state_select on public.timer_state;
create policy timer_state_select on public.timer_state for select to authenticated
  using (user_id = auth.uid() and public.is_approved());
-- Read-only for clients: every change goes through the timer_* functions.

create or replace function public._phase_seconds(p_user uuid, p_phase text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select 60 * case p_phase
    when 'focus'       then coalesce((select focus_minutes from public.pomodoro_settings where user_id = p_user), 25)
    when 'short_break' then coalesce((select short_break_minutes from public.pomodoro_settings where user_id = p_user), 5)
    else                    coalesce((select long_break_minutes from public.pomodoro_settings where user_id = p_user), 15)
  end;
$$;

create or replace function public._timer_elapsed(s public.timer_state) returns integer
language sql stable as $$
  select least(s.duration_seconds,
               s.accumulated_seconds + case when s.status = 'running'
                    then greatest(0, floor(extract(epoch from (now() - s.running_since)))::int) else 0 end);
$$;

create or replace function public._timer_json(p_user uuid, p_extra jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state; el int;
begin
  select * into s from public.timer_state where user_id = p_user;
  el := public._timer_elapsed(s);
  return jsonb_build_object(
    'state', to_jsonb(s),
    'server_now', now(),
    'elapsed_seconds', el,
    'remaining_seconds', greatest(0, s.duration_seconds - el)
  ) || p_extra;
end $$;

create or replace function public._timer_record(p_user uuid, s public.timer_state, p_status text, p_active int, p_ended timestamptz)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if s.phase <> 'focus' then return; end if;
  insert into public.study_sessions (id, user_id, module_id, lesson_id, task_id, planned_seconds, active_seconds,
                                     started_at, ended_at, status)
  values (s.session_id, p_user, s.module_id, s.lesson_id, s.task_id, s.duration_seconds, p_active,
          coalesce(s.started_at, p_ended - make_interval(secs => p_active)), p_ended, p_status)
  on conflict (id) do nothing;   -- duplicate protection
end $$;

create or replace function public._timer_ensure(p_user uuid) returns public.timer_state
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state;
begin
  if not exists (select 1 from public.profiles where id = p_user and status = 'approved') then
    raise exception 'Account not approved' using errcode = '42501';
  end if;
  insert into public.timer_state (user_id, duration_seconds)
  values (p_user, public._phase_seconds(p_user, 'focus'))
  on conflict (user_id) do nothing;
  select * into s from public.timer_state where user_id = p_user for update;
  return s;
end $$;

-- Finish the current phase (caller holds the row lock). Records the session once.
create or replace function public._timer_finish(p_user uuid, s public.timer_state) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare ended timestamptz; cyc int := s.focus_in_cycle; nxt text; long_every int;
begin
  ended := case when s.status = 'running'
                then least(now(), s.running_since + make_interval(secs => greatest(0, s.duration_seconds - s.accumulated_seconds)))
                else now() end;
  if s.phase = 'focus' then
    perform public._timer_record(p_user, s, 'completed', s.duration_seconds, ended);
    select coalesce((select sessions_before_long_break from public.pomodoro_settings where user_id = p_user), 4) into long_every;
    cyc := cyc + 1;
    if cyc >= long_every then nxt := 'long_break'; cyc := 0; else nxt := 'short_break'; end if;
  else
    nxt := 'focus';
  end if;
  update public.timer_state
     set phase = nxt, status = 'idle', duration_seconds = public._phase_seconds(p_user, nxt),
         accumulated_seconds = 0, running_since = null, started_at = null,
         session_id = gen_random_uuid(), focus_in_cycle = cyc, updated_at = now()
   where user_id = p_user;
end $$;

-- Load the timer (creates an idle row only if none exists). If a running timer ran out while the
-- browser was closed, it is finished here exactly once, with the correct end time.
create or replace function public.timer_sync() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state; fin text := null;
begin
  s := public._timer_ensure(auth.uid());
  if s.status = 'running' and public._timer_elapsed(s) >= s.duration_seconds then
    fin := s.phase;
    perform public._timer_finish(auth.uid(), s);
  end if;
  return public._timer_json(auth.uid(), jsonb_build_object('finished_phase', fin));
end $$;

create or replace function public.timer_start(p_module uuid default null, p_lesson uuid default null, p_task uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state;
begin
  s := public._timer_ensure(auth.uid());
  if s.status = 'running' then return public._timer_json(auth.uid()); end if;   -- idempotent
  if s.status = 'idle' then
    update public.timer_state
       set status = 'running', running_since = now(), started_at = now(), accumulated_seconds = 0,
           duration_seconds = public._phase_seconds(auth.uid(), phase),
           module_id = coalesce(p_module, module_id), lesson_id = case when p_module is not null or p_lesson is not null then p_lesson else lesson_id end,
           task_id = case when p_task is not null then p_task else task_id end, updated_at = now()
     where user_id = auth.uid();
  else  -- paused => resume
    update public.timer_state set status = 'running', running_since = now(), updated_at = now() where user_id = auth.uid();
  end if;
  return public._timer_json(auth.uid());
end $$;

create or replace function public.timer_pause() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state; fin text := null;
begin
  s := public._timer_ensure(auth.uid());
  if s.status = 'running' then
    if public._timer_elapsed(s) >= s.duration_seconds then
      fin := s.phase; perform public._timer_finish(auth.uid(), s);
    else
      update public.timer_state
         set accumulated_seconds = public._timer_elapsed(s), running_since = null, status = 'paused', updated_at = now()
       where user_id = auth.uid();
    end if;
  end if;
  return public._timer_json(auth.uid(), jsonb_build_object('finished_phase', fin));
end $$;

create or replace function public.timer_resume() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state;
begin
  s := public._timer_ensure(auth.uid());
  if s.status = 'paused' then
    update public.timer_state set status = 'running', running_since = now(), updated_at = now() where user_id = auth.uid();
  end if;
  return public._timer_json(auth.uid());
end $$;

-- Called by the client when the countdown reaches zero. Safe to call from several tabs/devices:
-- the row lock serialises them and the session id is unique, so only ONE session is stored.
create or replace function public.timer_complete() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state; fin text := null;
begin
  s := public._timer_ensure(auth.uid());
  if s.status = 'running' then
    if public._timer_elapsed(s) >= s.duration_seconds - 2 then   -- 2 s clock tolerance
      fin := s.phase;
      perform public._timer_finish(auth.uid(), s);
    else
      raise exception 'timer_not_finished' using errcode = 'P0001';
    end if;
  end if;
  return public._timer_json(auth.uid(), jsonb_build_object('finished_phase', fin));
end $$;

-- Reset: discards the current run. A focus run with >= 60 s of ACTIVE time is kept in history as 'interrupted'.
create or replace function public.timer_reset() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state; act int;
begin
  s := public._timer_ensure(auth.uid());
  act := public._timer_elapsed(s);
  if s.status <> 'idle' and s.phase = 'focus' and act >= 60 then
    perform public._timer_record(auth.uid(), s, 'interrupted', act, now());
  end if;
  update public.timer_state
     set status = 'idle', running_since = null, started_at = null, accumulated_seconds = 0,
         duration_seconds = public._phase_seconds(auth.uid(), phase), session_id = gen_random_uuid(), updated_at = now()
   where user_id = auth.uid();
  return public._timer_json(auth.uid());
end $$;

-- Skip: move to the next phase WITHOUT counting a skipped focus session as completed.
create or replace function public.timer_skip() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state; act int; nxt text; long_every int;
begin
  s := public._timer_ensure(auth.uid());
  act := public._timer_elapsed(s);
  if s.phase = 'focus' then
    if s.status <> 'idle' and act >= 60 then
      perform public._timer_record(auth.uid(), s, 'interrupted', act, now());
    end if;
    select coalesce((select sessions_before_long_break from public.pomodoro_settings where user_id = auth.uid()), 4) into long_every;
    nxt := case when s.focus_in_cycle + 1 >= long_every then 'long_break' else 'short_break' end;
  else
    nxt := 'focus';
  end if;
  update public.timer_state
     set phase = nxt, status = 'idle', running_since = null, started_at = null, accumulated_seconds = 0,
         duration_seconds = public._phase_seconds(auth.uid(), nxt), session_id = gen_random_uuid(), updated_at = now()
   where user_id = auth.uid();
  return public._timer_json(auth.uid());
end $$;

-- Choose the phase manually (Focus / Short break / Long break tabs). Only while idle.
create or replace function public.timer_set_phase(p_phase text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state;
begin
  if p_phase not in ('focus', 'short_break', 'long_break') then
    raise exception 'Invalid phase %', p_phase using errcode = '22023';
  end if;
  s := public._timer_ensure(auth.uid());
  if s.status <> 'idle' then raise exception 'timer_busy' using errcode = 'P0001'; end if;
  update public.timer_state
     set phase = p_phase, duration_seconds = public._phase_seconds(auth.uid(), p_phase),
         session_id = gen_random_uuid(), updated_at = now()
   where user_id = auth.uid();
  return public._timer_json(auth.uid());
end $$;

-- Change what the current focus session is associated with (module / lesson / planner task).
create or replace function public.timer_set_association(p_module uuid, p_lesson uuid, p_task uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._timer_ensure(auth.uid());
  update public.timer_state set module_id = p_module, lesson_id = p_lesson, task_id = p_task, updated_at = now()
   where user_id = auth.uid();
  return public._timer_json(auth.uid());
end $$;

-- After the student saves new Pomodoro durations: refresh an IDLE timer (never touches a running/paused one).
create or replace function public.timer_apply_settings() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.timer_state;
begin
  s := public._timer_ensure(auth.uid());
  if s.status = 'idle' then
    update public.timer_state set duration_seconds = public._phase_seconds(auth.uid(), phase), updated_at = now()
     where user_id = auth.uid();
  end if;
  return public._timer_json(auth.uid());
end $$;

-- Lets the browser compute an accurate clock offset.
create or replace function public.server_now() returns timestamptz
language sql stable as $$ select now(); $$;

-- ---------------------------------------------------------------------
-- 12. Privileges (defence in depth on top of RLS)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all tables    in schema public from authenticated;

grant select                         on public.profiles          to authenticated;
grant update (display_name, selected_year, selected_semester) on public.profiles to authenticated;
grant select                         on public.admin_audit_log   to authenticated;
grant select, insert, update, delete on public.modules           to authenticated;
grant select, insert, update, delete on public.lessons           to authenticated;
grant select, insert, update, delete on public.lesson_progress   to authenticated;
grant select, insert, update, delete on public.planner_tasks     to authenticated;
grant select, insert, update, delete on public.weekly_notes      to authenticated;
grant select, insert, update, delete on public.notes             to authenticated;
grant select, insert, update, delete on public.pomodoro_settings to authenticated;
grant select, insert, update, delete on public.user_preferences  to authenticated;
grant select, delete                 on public.study_sessions    to authenticated;
grant select                         on public.timer_state       to authenticated;

-- Function execution: only signed-in users (and each function re-checks role/approval itself).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              'is_admin','is_approved','admin_set_status','admin_stats','admin_reorder_modules','admin_reorder_lessons',
              'set_lesson_stage','save_weekly_notes','timer_sync','timer_start','timer_pause','timer_resume',
              'timer_complete','timer_reset','timer_skip','timer_set_phase','timer_set_association','timer_apply_settings','server_now')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  -- internal helpers are not callable by API clients at all
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              '_phase_seconds','_timer_elapsed','_timer_json','_timer_record','_timer_ensure','_timer_finish',
              'profiles_guard','handle_new_user','sync_initial_admin','_promote_if_initial_admin','planner_tasks_biu','notes_bu','touch_updated_at','modules_tree_guard')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
