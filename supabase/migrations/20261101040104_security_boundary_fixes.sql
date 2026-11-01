-- Canonical Storage keys, bounded server-only join admission, atomic job slots.
-- Deploy with the matching app change. No remote database is changed by this file.
begin;

create or replace function public.valid_package_pdf_path(p_path text, p_member uuid)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_path ~ ('^' || p_member::text || '/packages/[A-Za-z0-9_-]+/(resume|cover)\.pdf$'), false)
$$;
create or replace function public.valid_photo_path(p_path text, p_member uuid)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_path ~ ('^' || p_member::text || '/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$'), false)
$$;
create or replace function public.valid_snapshot_path(p_path text, p_application uuid)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_path in ('snapshots/' || p_application::text || '/resume.pdf',
    'snapshots/' || p_application::text || '/cover.pdf'), false)
$$;
revoke all on function public.valid_package_pdf_path(text, uuid), public.valid_photo_path(text, uuid),
  public.valid_snapshot_path(text, uuid) from public, anon;
grant execute on function public.valid_package_pdf_path(text, uuid), public.valid_photo_path(text, uuid),
  public.valid_snapshot_path(text, uuid) to authenticated, service_role;

create or replace function public.hiring_packages_path_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.member_id is not distinct from old.member_id
    and new.resume_path is not distinct from old.resume_path
    and new.cover_letter_path is not distinct from old.cover_letter_path then
    return new;
  end if;
  if not public.valid_package_pdf_path(new.resume_path, new.member_id) then
    raise exception 'Invalid resume path';
  end if;
  if new.cover_letter_path is not null
    and not public.valid_package_pdf_path(new.cover_letter_path, new.member_id) then
    raise exception 'Invalid cover letter path';
  end if;
  return new;
end;
$$;

create function public.canonical_object_paths_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'profiles' then
    if new.photo_path is not null and (tg_op = 'INSERT' or new.photo_path is distinct from old.photo_path)
      and not public.valid_photo_path(new.photo_path, new.id) then
      raise exception 'Invalid photo object path';
    end if;
  elsif new.kind = 'in_app' and (tg_op = 'INSERT'
    or new.resume_path is distinct from old.resume_path
    or new.cover_letter_path is distinct from old.cover_letter_path) then
    if not public.valid_snapshot_path(new.resume_path, new.id) then
      raise exception 'Invalid resume path';
    end if;
    if new.cover_letter_path is not null
      and not public.valid_snapshot_path(new.cover_letter_path, new.id) then
      raise exception 'Invalid cover letter path';
    end if;
  end if;
  return new;
end;
$$;
create trigger canonical_object_paths_guard before insert or update on public.profiles
  for each row execute function public.canonical_object_paths_guard();
create trigger canonical_object_paths_guard before insert or update on public.applications
  for each row execute function public.canonical_object_paths_guard();
revoke all on function public.canonical_object_paths_guard() from public, anon, authenticated;

-- Existing unsafe paths are never signed/downloaded by the app. Surface them
-- for manual repair without deleting documents or breaking unrelated edits.
do $$
declare n bigint;
begin
  select count(*) into n from public.hiring_packages
    where not public.valid_package_pdf_path(resume_path, member_id)
      or (cover_letter_path is not null and not public.valid_package_pdf_path(cover_letter_path, member_id));
  if n > 0 then raise warning '% existing packages have unsafe paths; re-upload before use', n; end if;
  select count(*) into n from public.profiles
    where photo_path is not null and not public.valid_photo_path(photo_path, id);
  if n > 0 then raise warning '% existing photos have unsafe paths; re-upload before use', n; end if;
  select count(*) into n from public.applications where kind = 'in_app' and
    (not public.valid_snapshot_path(resume_path, id) or (cover_letter_path is not null
      and not public.valid_snapshot_path(cover_letter_path, id)));
  if n > 0 then raise warning '% existing applications have unsafe paths; review before use', n; end if;
end;
$$;

-- Private bookkeeping is not an API surface and stores no plaintext IPs.
create schema if not exists connect_private;
revoke all on schema connect_private from public, anon, authenticated;
create table connect_private.join_admission (
  key text primary key,
  used integer not null,
  expires_at timestamptz not null
);
create index on connect_private.join_admission (expires_at);
alter table connect_private.join_admission enable row level security;
revoke all on connect_private.join_admission from public, anon, authenticated;

revoke insert on public.company_join_requests from anon, authenticated;
drop policy if exists join_requests_insert_anon on public.company_join_requests;
drop policy if exists join_requests_insert_authenticated on public.company_join_requests;

-- Validate changed public fields without blocking review of legacy requests.
create function public.join_request_bounds_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and row(new.company_name, new.contact_name, new.contact_email, new.website, new.note)
    is not distinct from row(old.company_name, old.contact_name, old.contact_email, old.website, old.note) then
    return new;
  end if;
  if char_length(new.company_name) not between 1 and 200
    or char_length(new.contact_name) not between 1 and 120
    or char_length(new.contact_email) not between 3 and 254
    or coalesce(char_length(new.website), 0) > 500
    or coalesce(char_length(new.note), 0) > 2000 then
    raise exception 'Invalid request fields';
  end if;
  return new;
end;
$$;
create trigger join_request_bounds_guard before insert or update on public.company_join_requests
  for each row execute function public.join_request_bounds_guard();
revoke all on function public.join_request_bounds_guard() from public, anon, authenticated;

-- Bound the queue payload even for oversized rows that predate this migration.
-- Originals remain intact for review; invoker security preserves admin-only RLS.
create view public.company_join_request_queue with (security_invoker = true) as
  select id, created_at, status,
    left(company_name, 200) as company_name,
    left(contact_name, 120) as contact_name,
    left(contact_email, 254) as contact_email,
    left(note, 2000) as note
  from public.company_join_requests;
revoke all on public.company_join_request_queue from public, anon, authenticated;
grant select on public.company_join_request_queue to authenticated, service_role;

create function public.submit_join_request(p_company_name text, p_website text,
  p_contact_name text, p_contact_email text, p_note text, p_source text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t timestamptz := clock_timestamp();
  bucket record;
  attempts integer;
begin
  p_company_name := btrim(p_company_name);
  p_contact_name := btrim(p_contact_name);
  p_contact_email := lower(btrim(p_contact_email));
  if p_company_name is null or char_length(p_company_name) not between 1 and 200
    or p_contact_name is null or char_length(p_contact_name) not between 1 and 120
    or p_contact_email is null or char_length(p_contact_email) > 254
    or p_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or coalesce(char_length(p_website), 0) > 500
    or (p_website is not null and p_website !~ '^https?://')
    or coalesce(char_length(p_note), 0) > 2000
    or p_source is null or p_source !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request fields';
  end if;

  -- Global keys are acquired first, serializing admission including queue size.
  -- Fixed UTC windows: 100/hour, 500/day; source 5/hour; email 3/day.
  delete from connect_private.join_admission where expires_at <= t;
  for bucket in
    select * from (values
      ('global-day:' || floor(extract(epoch from t) / 86400), 500, 86400),
      ('global-hour:' || floor(extract(epoch from t) / 3600), 100, 3600),
      ('source:' || p_source || ':' || floor(extract(epoch from t) / 3600), 5, 3600),
      ('email:' || md5(p_contact_email) || ':' || floor(extract(epoch from t) / 86400), 3, 86400)
    ) as limits(key, maximum, seconds)
  loop
    insert into connect_private.join_admission as admission (key, used, expires_at)
      values (bucket.key, 1, to_timestamp((floor(extract(epoch from t) / bucket.seconds) + 1) * bucket.seconds))
      on conflict (key) do update set used = least(admission.used + 1, bucket.maximum + 1)
      returning used into attempts;
    if attempts > bucket.maximum then return; end if;
  end loop;
  if (select count(*) from public.company_join_requests where status = 'pending') >= 1000 then return; end if;
  insert into public.company_join_requests (company_name, website, contact_name, contact_email, note)
    values (p_company_name, p_website, p_contact_name, p_contact_email, p_note)
    on conflict (lower(contact_email)) where status = 'pending' do nothing;
end;
$$;
revoke all on function public.submit_join_request(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_join_request(text, text, text, text, text, text) to service_role;

-- An atomic counter, rather than a snapshot count, covers bulk statements and
-- concurrent writers at READ COMMITTED and raises conflicts at stronger isolation.
-- Lock posts before initializing to eliminate an installation-time count race.
lock table public.posts in share row exclusive mode;
create table connect_private.job_slots (
  company_id uuid primary key references public.companies(id) on delete cascade,
  used integer not null check (used >= 0)
);
alter table connect_private.job_slots enable row level security;
revoke all on connect_private.job_slots from public, anon, authenticated;
insert into connect_private.job_slots (company_id, used)
  select company_id, count(*)::integer from public.posts
  where company_id is not null and kind = 'job' and external_url is null and status = 'open'
  group by company_id;

create or replace function public.posts_in_app_quota_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_company uuid;
  new_company uuid;
  target uuid;
  quota integer;
  used_slots integer;
begin
  if tg_op = 'UPDATE' and new.author_id is distinct from old.author_id and not public.is_admin() then
    raise exception 'Post author cannot be changed';
  end if;
  if tg_op <> 'INSERT' and old.kind = 'job' and old.external_url is null and old.status = 'open' then
    old_company := old.company_id;
  end if;
  if tg_op <> 'DELETE' and new.kind = 'job' and new.external_url is null and new.status = 'open' then
    new_company := new.company_id;
  end if;
  if old_company is not distinct from new_company then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  -- Order locks for admin company transfers. A deleted parent needs no counter.
  for target in select id from public.companies
    where id in (old_company, new_company) order by id
  loop
    insert into connect_private.job_slots(company_id, used) values(target, 0)
      on conflict (company_id) do nothing;
    perform 1 from connect_private.job_slots where company_id = target for update;
  end loop;
  if new_company is not null then
    -- Admin inserts already bypassed the RLS quota. Continue recording their
    -- slots; ordinary company users always acquire within their current cap.
    if tg_op <> 'INSERT' or (auth.uid() is not null and not public.is_admin()) then
      if not public.company_has_capability(new_company, 'post_in_app_job') then
        raise exception 'This firm is not allowed to post in-app jobs';
      end if;
      quota := public.company_capability_value(new_company, 'post_in_app_job');
    end if;
    update connect_private.job_slots set used = used + 1
      where company_id = new_company and (quota is null or used < quota)
      returning used into used_slots;
    if not found then raise exception 'This firm has reached its open in-app job limit'; end if;
  end if;
  if old_company is not null then
    update connect_private.job_slots set used = used - 1 where company_id = old_company;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
drop trigger posts_in_app_quota_guard on public.posts;
-- AFTER avoids reserving an extra slot for INSERT ... ON CONFLICT DO UPDATE.
-- Exceptions still roll back the complete statement, including every slot.
create trigger posts_in_app_quota_guard after insert or update or delete on public.posts
  for each row execute function public.posts_in_app_quota_guard();
revoke all on function public.posts_in_app_quota_guard() from public, anon, authenticated;

-- Keep the capability/ownership ladder; only the counter owns numeric limits.
drop policy posts_company_insert on public.posts;
create policy posts_company_insert on public.posts for insert to authenticated with check (
  company_id = public.my_company_id() and author_id = auth.uid() and (
    kind in ('announcement', 'job_link') or (kind = 'job' and external_url is not null)
    or (kind = 'event' and public.my_capability('post_event'))
    or (kind = 'job' and external_url is null and public.my_capability('post_in_app_job'))
  )
);

-- Local test_reset and maintenance truncation must not leave stale slots.
create function public.posts_reset_job_slots()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from connect_private.job_slots;
  return null;
end;
$$;
create trigger posts_reset_job_slots after truncate on public.posts
  for each statement execute function public.posts_reset_job_slots();
revoke all on function public.posts_reset_job_slots() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
