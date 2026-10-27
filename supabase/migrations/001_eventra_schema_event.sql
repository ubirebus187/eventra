-- Eventra v1. Run once in Supabase SQL Editor, before creating Auth users.
-- All event records are visible to authenticated users only.
-- PIC edits events assigned to them; admin can edit/delete any event.
-- Before using client calls, expose "event" under Supabase API settings > Exposed schemas.
-- In Next.js query event schema, e.g. supabase.schema('event').from('events').select('*').

-- App objects use schema event (not public). Auth remains auth.users.
-- For a fresh database. This script DOES NOT move existing public tables or data.
create schema if not exists event;

grant usage on schema event to authenticated, service_role;

create extension if not exists pgcrypto;

create table if not exists event.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role text not null default 'pic' check (role in ('admin','pic')),
  created_at timestamptz not null default now()
);

create or replace function event.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into event.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''), split_part(coalesce(new.email,''),'@',1)),
    coalesce(new.email,''),
    'pic'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists auth_user_created_eventra on auth.users;
create trigger auth_user_created_eventra after insert on auth.users
for each row execute function event.on_auth_user_created();

-- Backfill if users already existed before the migration.
insert into event.profiles(id,full_name,email,role)
select id, coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),split_part(coalesce(email,''),'@',1)), coalesce(email,''),'pic'
from auth.users on conflict (id) do nothing;

-- SECURITY DEFINER avoids recursive RLS checks on profiles.
create or replace function event.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from event.profiles p where p.id = (select auth.uid()) and p.role = 'admin');
$$;

create table if not exists event.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 160),
  description text not null default '',
  category text not null default 'Lainnya',
  location text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  priority text not null default 'mid' check (priority in ('high','mid','low')),
  progress integer not null default 0 check (progress between 0 and 100),
  status text generated always as (
    case when progress = 100 then 'completed'
         when progress = 0 then 'not_started'
         else 'in_progress' end
  ) stored,
  assigned_pic uuid not null references event.profiles(id),
  created_by uuid not null references auth.users(id),
  participant_target integer not null default 0 check (participant_target >= 0),
  budget numeric(16,2) not null default 0 check (budget >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_date_order check (end_at > start_at)
);

create index if not exists eventra_events_date_idx on event.events(start_at);
create index if not exists eventra_events_pic_idx on event.events(assigned_pic);
create index if not exists eventra_events_priority_idx on event.events(priority);

create or replace function event.protect_event_metadata()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Auth user cannot claim they created an event as someone else (RLS also enforces this).
    new.created_by := (select auth.uid());
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists eventra_event_metadata on event.events;
create trigger eventra_event_metadata before insert or update on event.events
for each row execute function event.protect_event_metadata();

create table if not exists event.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references event.events(id) on delete cascade,
  kind text not null check (kind in ('upcoming','tomorrow','today')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,event_id,kind)
);
create index if not exists eventra_notifications_user_idx on event.notifications(user_id,created_at desc);

create or replace function event.clean_event_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.start_at is distinct from old.start_at or (new.progress = 100 and old.progress <> 100) then
    delete from event.notifications where event_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists eventra_clean_reminders on event.events;
create trigger eventra_clean_reminders after update on event.events
for each row execute function event.clean_event_reminders();

-- Explicitly revoke anonymous table access and grant only what the UI needs.
alter table event.profiles enable row level security;
alter table event.events enable row level security;
alter table event.notifications enable row level security;

revoke all on table event.profiles, event.events, event.notifications from anon, authenticated;
grant select on event.profiles to authenticated;
grant select, insert, update, delete on event.events to authenticated;
grant select on event.notifications to authenticated;
grant update (read_at) on event.notifications to authenticated;

create policy "profiles_authenticated_read" on event.profiles
  for select to authenticated using (true);

create policy "events_authenticated_read" on event.events
  for select to authenticated using (true);
create policy "events_pic_or_admin_insert" on event.events
  for insert to authenticated with check (
    created_by = (select auth.uid()) and
    ((select event.is_admin()) or assigned_pic = (select auth.uid()))
  );
create policy "events_pic_or_admin_update" on event.events
  for update to authenticated
  using ((select event.is_admin()) or assigned_pic = (select auth.uid()))
  with check ((select event.is_admin()) or assigned_pic = (select auth.uid()));
create policy "events_admin_delete" on event.events
  for delete to authenticated using ((select event.is_admin()));

create policy "notifications_user_read" on event.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications_user_update" on event.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Only an admin can change roles. Admins cannot demote themselves.
create or replace function event.set_user_role(target_user_id uuid, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not event.is_admin() then raise exception 'Hanya Admin yang dapat mengubah peran.' using errcode = '42501'; end if;
  if target_user_id = (select auth.uid()) then raise exception 'Admin tidak dapat mengubah perannya sendiri.' using errcode = '42501'; end if;
  if new_role not in ('pic','admin') then raise exception 'Peran tidak valid.'; end if;
  update event.profiles set role = new_role where id = target_user_id;
  if not found then raise exception 'Pengguna tidak ditemukan.'; end if;
end;
$$;

-- A private implementation function only called from trusted wrappers / Cron.
create or replace function event._generate_event_reminders(target_user_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  insert into event.notifications(user_id,event_id,kind)
  select p.id,e.id,
    case
      when (e.start_at at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date then 'today'
      when (e.start_at at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date + 1 then 'tomorrow'
      else 'upcoming'
    end
  from event.profiles p
  cross join event.events e
  where (target_user_id is null or p.id = target_user_id)
    and e.progress < 100
    and (e.start_at at time zone 'Asia/Jakarta')::date between (now() at time zone 'Asia/Jakarta')::date
      and (now() at time zone 'Asia/Jakarta')::date + 7
  on conflict (user_id,event_id,kind) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function event.sync_my_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Login diperlukan.' using errcode = '42501'; end if;
  return event._generate_event_reminders((select auth.uid()));
end;
$$;

-- Run by optional Supabase Cron, not callable by browser users.
create or replace function event.dispatch_event_reminders()
returns integer language sql security definer set search_path = '' as $$
  select event._generate_event_reminders(null::uuid);
$$;

revoke all on function event.is_admin(), event.on_auth_user_created(), event.protect_event_metadata(),
  event.clean_event_reminders(), event._generate_event_reminders(uuid), event.sync_my_reminders(),
  event.dispatch_event_reminders(), event.set_user_role(uuid,text) from public, anon, authenticated;
grant execute on function event.is_admin(), event.sync_my_reminders(), event.set_user_role(uuid,text) to authenticated;

-- Enable live updates if the Supabase realtime publication is available.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='event' and tablename='events') then
      alter publication supabase_realtime add table event.events;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='event' and tablename='notifications') then
      alter publication supabase_realtime add table event.notifications;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='event' and tablename='profiles') then
      alter publication supabase_realtime add table event.profiles;
    end if;
  end if;
end $$;
