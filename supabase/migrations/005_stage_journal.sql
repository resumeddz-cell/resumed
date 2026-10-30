-- Carnet de stage (from the 3rd year): one entry per stage day — date, placement, topic,
-- what I learned, my weaknesses and my strengths. Private to each student. Safe to re-run.
begin;
create table if not exists public.stage_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  entry_date  date not null default current_date,
  stage_name  text not null default '' check (char_length(stage_name) <= 200),
  topic       text not null default '' check (char_length(topic) <= 500),
  learned     text not null default '' check (char_length(learned) <= 100000),
  weaknesses  text not null default '' check (char_length(weaknesses) <= 50000),
  strengths   text not null default '' check (char_length(strengths) <= 50000),
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists stage_entries_user_idx on public.stage_entries (user_id, entry_date desc, created_at desc);

create or replace function public.stage_entries_bu() returns trigger
language plpgsql as $$
begin
  if (new.entry_date, new.stage_name, new.topic, new.learned, new.weaknesses, new.strengths)
     is distinct from (old.entry_date, old.stage_name, old.topic, old.learned, old.weaknesses, old.strengths) then
    new.version := old.version + 1;
    new.updated_at := now();
  else
    new.version := old.version; new.updated_at := old.updated_at;
  end if;
  new.id := old.id; new.user_id := old.user_id; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists stage_entries_bu_trg on public.stage_entries;
create trigger stage_entries_bu_trg before update on public.stage_entries for each row execute function public.stage_entries_bu();

alter table public.stage_entries enable row level security;
drop policy if exists stage_entries_own on public.stage_entries;
create policy stage_entries_own on public.stage_entries for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

revoke all on public.stage_entries from anon;
grant select, insert, update, delete on public.stage_entries to authenticated;
revoke execute on function public.stage_entries_bu() from public, anon, authenticated;
commit;
