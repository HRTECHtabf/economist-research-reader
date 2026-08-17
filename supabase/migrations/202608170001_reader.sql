create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'reader' check (role in ('reader', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create table if not exists public.reader_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  article_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, article_key)
);

create table if not exists public.reader_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  article_key text not null,
  context_id text not null,
  quote text not null,
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset),
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reader_notes_user_article_idx
  on public.reader_notes (user_id, article_key, updated_at desc);

create table if not exists public.saved_search_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 24),
  query text not null check (char_length(query) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, label)
);

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_label text not null default '瀏覽器',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists user_devices_user_seen_idx
  on public.user_devices (user_id, last_seen_at desc);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_name text not null,
  issue_key text,
  status text not null check (status in ('running', 'success', 'failed', 'skipped')),
  detected_articles integer,
  completed_articles integer,
  error_summary text,
  github_run_url text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists automation_runs_started_idx
  on public.automation_runs (started_at desc);

create table if not exists public.app_integrations (
  id text primary key,
  provider text not null,
  enabled boolean not null default false,
  endpoint_label text,
  deployment_name text,
  secret_reference text,
  last_tested_at timestamptz,
  last_test_status text check (last_test_status in ('success', 'failed') or last_test_status is null),
  updated_at timestamptz not null default now(),
  constraint no_plaintext_secret check (
    secret_reference is null or secret_reference !~* '(api[_-]?key|bearer)\s*[:=]'
  )
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();
drop trigger if exists reader_notes_set_updated_at on public.reader_notes;
create trigger reader_notes_set_updated_at before update on public.reader_notes
for each row execute procedure public.set_updated_at();
drop trigger if exists saved_search_tags_set_updated_at on public.saved_search_tags;
create trigger saved_search_tags_set_updated_at before update on public.saved_search_tags
for each row execute procedure public.set_updated_at();
drop trigger if exists app_integrations_set_updated_at on public.app_integrations;
create trigger app_integrations_set_updated_at before update on public.app_integrations
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.reader_favorites enable row level security;
alter table public.reader_notes enable row level security;
alter table public.saved_search_tags enable row level security;
alter table public.user_devices enable row level security;
alter table public.automation_runs enable row level security;
alter table public.app_integrations enable row level security;

create policy "profiles_read_own" on public.profiles for select
using (id = auth.uid() or public.is_admin());
create policy "profiles_update_own" on public.profiles for update
using (id = auth.uid()) with check (id = auth.uid() and role = 'reader');

create policy "favorites_own_all" on public.reader_favorites for all
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notes_own_all" on public.reader_notes for all
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "saved_tags_own_all" on public.saved_search_tags for all
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "devices_own_all" on public.user_devices for all
using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "automation_runs_admin_read" on public.automation_runs for select
using (public.is_admin());
create policy "integrations_admin_read" on public.app_integrations for select
using (public.is_admin());
create policy "integrations_admin_update" on public.app_integrations for update
using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.reader_favorites to authenticated;
grant select, insert, update, delete on public.reader_notes to authenticated;
grant select, insert, update, delete on public.saved_search_tags to authenticated;
grant select, insert, update, delete on public.user_devices to authenticated;
grant select on public.automation_runs to authenticated;
grant select, update on public.app_integrations to authenticated;
