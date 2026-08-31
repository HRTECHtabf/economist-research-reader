alter table public.reader_notes
  add constraint reader_notes_quote_length check (char_length(quote) between 1 and 4000),
  add constraint reader_notes_body_length check (char_length(body) <= 10000),
  add constraint reader_notes_context_length check (char_length(context_id) between 1 and 160);

alter table public.user_devices
  add constraint user_devices_label_length check (char_length(device_label) between 1 and 80);

create or replace function public.enforce_reader_item_limits()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  current_count bigint;
  item_limit integer;
begin
  if tg_table_name = 'reader_notes' then item_limit := 2000;
  elsif tg_table_name = 'saved_search_tags' then item_limit := 100;
  elsif tg_table_name = 'user_devices' then item_limit := 20;
  else raise exception 'Unsupported reader item table';
  end if;

  execute format('select count(*) from public.%I where user_id = $1', tg_table_name)
    into current_count using new.user_id;
  if current_count >= item_limit then
    raise exception 'Reader item limit reached for %', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists reader_notes_limit on public.reader_notes;
create trigger reader_notes_limit before insert on public.reader_notes
for each row execute procedure public.enforce_reader_item_limits();
drop trigger if exists saved_search_tags_limit on public.saved_search_tags;
create trigger saved_search_tags_limit before insert on public.saved_search_tags
for each row execute procedure public.enforce_reader_item_limits();
drop trigger if exists user_devices_limit on public.user_devices;
create trigger user_devices_limit before insert on public.user_devices
for each row execute procedure public.enforce_reader_item_limits();

create or replace function public.prune_maintenance_data(retain_days integer default 180)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  deleted_count integer;
begin
  if retain_days < 30 then raise exception 'retain_days must be at least 30'; end if;
  delete from public.automation_runs
  where created_at < now() - make_interval(days => retain_days);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.enforce_reader_item_limits() from public, anon, authenticated;
revoke all on function public.prune_maintenance_data(integer) from public, anon, authenticated;
grant execute on function public.prune_maintenance_data(integer) to service_role;
