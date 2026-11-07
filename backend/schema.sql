-- NeoMods backend for Supabase.
--
-- Run this whole file once in the Supabase SQL editor (SQL Editor -> New query -> paste -> Run).
-- It is safe to run again after an update: it only creates what is missing and refreshes the rest.
--
-- How the security works (short version):
--   * Visitors can READ projects and releases that are not hidden. Nothing else.
--   * Visitors cannot write to any table directly. They can only call create_project() and
--     add_release(), and those functions check every field, every file and a rate limit.
--   * Visitors can upload files, but only into uploads/<uuid>/ with an allowed extension and
--     only up to the size limit of the bucket.
--   * Only users listed in the "admins" table (you) can hide, delete and list hidden projects.
--   * Authors get a secret edit key when they upload. Only its hash is stored. With the key they can
--     add new versions of their own project. They cannot delete anything.

-- =====================================================================
-- Tables
-- =====================================================================

create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name             text not null check (char_length(name) between 2 and 60),
  type             text not null check (type in ('mod', 'plugin')),
  -- 'neolegacy' for mods. For plugins the server software, e.g. 'fourkit'. New platforms need no SQL change.
  platform         text not null default 'neolegacy' check (platform ~ '^[a-z0-9-]{1,30}$'),
  summary          text not null check (char_length(summary) between 5 and 140),
  description      text not null default '' check (char_length(description) <= 8000),
  author           text not null check (char_length(author) between 1 and 40),
  categories       text[] not null default '{}' check (cardinality(categories) <= 5),
  icon_path        text not null,
  screenshot_paths text[] not null default '{}' check (cardinality(screenshot_paths) <= 6),
  links            jsonb not null default '{}'::jsonb,
  hidden           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.releases (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version    text not null check (version ~ '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,19}$'),
  neolegacy  text[] not null check (cardinality(neolegacy) between 1 and 20),
  file_path  text not null,
  file_name  text not null,
  file_size  bigint not null check (file_size > 0),
  changelog  text not null default '' check (char_length(changelog) <= 300),
  created_at timestamptz not null default now(),
  unique (project_id, version)
);
create index if not exists releases_project_idx on public.releases (project_id, created_at desc);
create index if not exists projects_updated_idx on public.projects (updated_at desc);

-- Only the hash of the edit key is stored, in a table nobody can read through the API.
create table if not exists public.project_secrets (
  project_id uuid primary key references public.projects (id) on delete cascade,
  token_hash text not null
);

-- People who may moderate. Filled by you once, see the end of this file.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.rate_limits (
  id      bigserial primary key,
  bucket  text not null,
  ip_hash text not null,
  at      timestamptz not null default now()
);
create index if not exists rate_limits_idx on public.rate_limits (bucket, ip_hash, at);
create index if not exists rate_limits_at_idx on public.rate_limits (at);

alter table public.projects        enable row level security;
alter table public.releases        enable row level security;
alter table public.project_secrets enable row level security;
alter table public.admins          enable row level security;
alter table public.rate_limits     enable row level security;
-- project_secrets, admins and rate_limits get no policies on purpose: the API can never read or write them.

-- =====================================================================
-- Helpers
-- =====================================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Counts calls per visitor (hashed IP) and stops when a limit is reached.
-- With p_record = false it only checks, it does not count.
drop function if exists public.check_rate_limit(text, int, interval);
create or replace function public.check_rate_limit(p_bucket text, p_max int, p_window interval, p_record boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  hdrs json;
  ip   text;
  h    text;
  n    int;
begin
  begin
    hdrs := current_setting('request.headers', true)::json;
  exception when others then
    hdrs := null;
  end;
  ip := split_part(coalesce(hdrs ->> 'x-forwarded-for', hdrs ->> 'cf-connecting-ip', ''), ',', 1);
  h  := md5(coalesce(nullif(btrim(ip), ''), 'unknown'));

  delete from public.rate_limits where at < now() - interval '2 days';

  select count(*) into n from public.rate_limits
   where bucket = p_bucket and ip_hash = h and at > now() - p_window;
  if n >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if p_record then
    insert into public.rate_limits (bucket, ip_hash) values (p_bucket, h);
  end if;
end $$;

create or replace function public.nm_text(v text, lo int, hi int, field text, multiline boolean default false)
returns text language plpgsql immutable as $$
begin
  v := btrim(coalesce(v, ''));
  if char_length(v) < lo or char_length(v) > hi
     or (not multiline and v ~ '[[:cntrl:]]')
     or (multiline and v ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]') then
    raise exception 'invalid_input:%', field using errcode = 'P0001';
  end if;
  return v;
end $$;

-- A file name is allowed when it is simple and has the right extension for its kind.
create or replace function public.nm_name_ok(n text, kind text)
returns boolean language sql immutable as $$
  select n ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     and n !~ '\.\.'
     and case kind
           when 'image' then n ~* '\.(png|jpe?g|webp|gif)$'
           else              n ~* '\.(zip|jar|dll|7z|rar)$'
         end;
$$;

create or replace function public.nm_object_size(p_path text)
returns bigint language sql stable security definer set search_path = public, storage as $$
  select (metadata ->> 'size')::bigint from storage.objects where bucket_id = 'files' and name = p_path;
$$;

-- Checks one uploaded file and returns its size.
create or replace function public.nm_check_file(p_folder text, p_name text, kind text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  sz bigint;
  max_size bigint := case kind when 'image' then 2097152 else 52428800 end; -- 2 MB / 50 MB
begin
  if not public.nm_name_ok(p_name, kind) then
    raise exception 'invalid_input:file' using errcode = 'P0001';
  end if;
  sz := public.nm_object_size('uploads/' || p_folder || '/' || p_name);
  if sz is null or sz <= 0 then
    raise exception 'file_missing' using errcode = 'P0001';
  end if;
  if sz > max_size then
    raise exception 'file_too_large' using errcode = 'P0001';
  end if;
  return sz;
end $$;

create or replace function public.nm_check_versions(p jsonb)
returns text[] language plpgsql immutable as $$
declare
  v text;
  res text[] := '{}';
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 1 and 20 then
    raise exception 'invalid_input:neolegacy' using errcode = 'P0001';
  end if;
  for v in select jsonb_array_elements_text(p) loop
    if v !~ '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,19}$' then
      raise exception 'invalid_input:neolegacy' using errcode = 'P0001';
    end if;
    if not v = any (res) then res := array_append(res, v); end if;
  end loop;
  return res;
end $$;

create or replace function public.nm_check_folder(p_folder text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(p_folder, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_input:folder' using errcode = 'P0001';
  end if;
  -- one upload folder belongs to exactly one submission
  if exists (select 1 from public.projects where icon_path like 'uploads/' || p_folder || '/%')
     or exists (select 1 from public.releases where file_path like 'uploads/' || p_folder || '/%') then
    raise exception 'invalid_input:folder' using errcode = 'P0001';
  end if;
  return p_folder;
end $$;

-- =====================================================================
-- Public actions
-- =====================================================================

create or replace function public.create_project(p jsonb, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_type text; v_platform text; v_name text; v_summary text; v_desc text; v_author text;
  v_cats text[] := '{}'; v_links jsonb := '{}'::jsonb; v_folder text; v_icon text;
  v_shots text[] := '{}'; v_version text; v_compat text[]; v_file text; v_changelog text;
  v_size bigint; v_base text; v_slug text; v_try int := 0; v_id uuid; v_item text; v_key text; v_val text;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'invalid_input:body' using errcode = 'P0001';
  end if;
  -- hidden form field that only bots fill in
  if btrim(coalesce(p ->> 'website', '')) <> '' then
    raise exception 'rejected' using errcode = 'P0001';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'invalid_input:key' using errcode = 'P0001';
  end if;

  v_type := coalesce(p ->> 'type', '');
  if v_type not in ('mod', 'plugin') then
    raise exception 'invalid_input:type' using errcode = 'P0001';
  end if;
  v_platform := case when v_type = 'mod' then 'neolegacy' else coalesce(p ->> 'platform', '') end;
  if v_platform !~ '^[a-z0-9-]{1,30}$' or (v_type = 'plugin' and v_platform = 'neolegacy') then
    raise exception 'invalid_input:platform' using errcode = 'P0001';
  end if;

  v_name    := public.nm_text(p ->> 'name', 2, 60, 'name');
  v_summary := public.nm_text(p ->> 'summary', 5, 140, 'summary');
  v_desc    := public.nm_text(p ->> 'description', 0, 8000, 'description', true);
  v_author  := public.nm_text(p ->> 'author', 1, 40, 'author');

  if jsonb_typeof(p -> 'categories') = 'array' then
    if jsonb_array_length(p -> 'categories') > 5 then
      raise exception 'invalid_input:categories' using errcode = 'P0001';
    end if;
    for v_item in select jsonb_array_elements_text(p -> 'categories') loop
      if v_item !~ '^[A-Za-z][A-Za-z &]{0,29}$' then
        raise exception 'invalid_input:categories' using errcode = 'P0001';
      end if;
      v_cats := array_append(v_cats, v_item);
    end loop;
  end if;

  foreach v_key in array array['source', 'issues', 'website', 'discord'] loop
    v_val := btrim(coalesce(p -> 'links' ->> v_key, ''));
    if v_val <> '' then
      if v_val !~ '^https://[^[:space:]]{3,255}$' then
        raise exception 'invalid_input:links' using errcode = 'P0001';
      end if;
      v_links := v_links || jsonb_build_object(v_key, v_val);
    end if;
  end loop;

  v_folder := public.nm_check_folder(p ->> 'folder');
  v_icon   := p ->> 'icon';
  perform public.nm_check_file(v_folder, v_icon, 'image');

  if jsonb_typeof(p -> 'screenshots') = 'array' then
    if jsonb_array_length(p -> 'screenshots') > 6 then
      raise exception 'invalid_input:screenshots' using errcode = 'P0001';
    end if;
    for v_item in select jsonb_array_elements_text(p -> 'screenshots') loop
      perform public.nm_check_file(v_folder, v_item, 'image');
      v_shots := array_append(v_shots, 'uploads/' || v_folder || '/' || v_item);
    end loop;
  end if;

  v_version   := public.nm_text(p ->> 'version', 1, 20, 'version');
  if v_version !~ '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,19}$' then
    raise exception 'invalid_input:version' using errcode = 'P0001';
  end if;
  v_compat    := public.nm_check_versions(p -> 'neolegacy');
  v_changelog := public.nm_text(p ->> 'changelog', 0, 300, 'changelog');
  v_file      := p ->> 'file';
  v_size      := public.nm_check_file(v_folder, v_file, 'file');

  perform public.check_rate_limit('create', 5, interval '1 hour');

  v_base := btrim(left(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), 48), '-');
  if v_base = '' then v_base := 'project'; end if;

  loop
    v_slug := case when v_try = 0 then v_base else v_base || '-' || (v_try + 1) end;
    begin
      insert into public.projects (slug, name, type, platform, summary, description, author,
                                   categories, icon_path, screenshot_paths, links)
      values (v_slug, v_name, v_type, v_platform, v_summary, v_desc, v_author,
              v_cats, 'uploads/' || v_folder || '/' || v_icon, v_shots, v_links)
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 30 then
        raise exception 'invalid_input:name' using errcode = 'P0001';
      end if;
    end;
  end loop;

  insert into public.project_secrets (project_id, token_hash)
  values (v_id, encode(sha256(convert_to(p_token, 'utf8')), 'hex'));

  insert into public.releases (project_id, version, neolegacy, file_path, file_name, file_size, changelog)
  values (v_id, v_version, v_compat, 'uploads/' || v_folder || '/' || v_file, v_file, v_size, v_changelog);

  return jsonb_build_object('slug', v_slug);
end $$;

create or replace function public.add_release(p_slug text, p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_hash text; v_version text; v_compat text[]; v_changelog text;
  v_folder text; v_file text; v_size bigint;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'invalid_input:body' using errcode = 'P0001';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'bad_key' using errcode = 'P0001';
  end if;

  select pr.id, s.token_hash into v_id, v_hash
    from public.projects pr join public.project_secrets s on s.project_id = pr.id
   where pr.slug = coalesce(p_slug, '') and not pr.hidden;
  if v_id is null or v_hash <> encode(sha256(convert_to(p_token, 'utf8')), 'hex') then
    -- same answer for "no such project" and "wrong key" so keys cannot be probed
    raise exception 'bad_key' using errcode = 'P0001';
  end if;

  v_version := public.nm_text(p ->> 'version', 1, 20, 'version');
  if v_version !~ '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,19}$' then
    raise exception 'invalid_input:version' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.releases where project_id = v_id and version = v_version) then
    raise exception 'version_exists' using errcode = 'P0001';
  end if;
  v_compat    := public.nm_check_versions(p -> 'neolegacy');
  v_changelog := public.nm_text(p ->> 'changelog', 0, 300, 'changelog');
  v_folder    := public.nm_check_folder(p ->> 'folder');
  v_file      := p ->> 'file';
  v_size      := public.nm_check_file(v_folder, v_file, 'file');

  perform public.check_rate_limit('release', 20, interval '1 day');

  insert into public.releases (project_id, version, neolegacy, file_path, file_name, file_size, changelog)
  values (v_id, v_version, v_compat, 'uploads/' || v_folder || '/' || v_file, v_file, v_size, v_changelog);
  update public.projects set updated_at = now() where id = v_id;

  return jsonb_build_object('slug', p_slug);
end $$;

-- Lets the page check the edit key and version BEFORE a big file is uploaded.
create or replace function public.check_release_access(p_slug text, p_token text, p_version text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_hash text; v text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'bad_key' using errcode = 'P0001';
  end if;
  select pr.id, s.token_hash into v_id, v_hash
    from public.projects pr join public.project_secrets s on s.project_id = pr.id
   where pr.slug = coalesce(p_slug, '') and not pr.hidden;
  if v_id is null or v_hash <> encode(sha256(convert_to(p_token, 'utf8')), 'hex') then
    raise exception 'bad_key' using errcode = 'P0001';
  end if;
  v := public.nm_text(p_version, 1, 20, 'version');
  if v !~ '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,19}$' then
    raise exception 'invalid_input:version' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.releases where project_id = v_id and version = v) then
    raise exception 'version_exists' using errcode = 'P0001';
  end if;
  return true;
end $$;

-- Lets the page ask "may I still publish?" before it uploads anything. It does not count as a publish.
create or replace function public.can_publish(p_kind text default 'create')
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'release' then
    perform public.check_rate_limit('release', 20, interval '1 day', false);
  else
    perform public.check_rate_limit('create', 5, interval '1 hour', false);
  end if;
  return true;
end $$;

-- =====================================================================
-- Permissions
-- =====================================================================

-- Start from nothing, then open exactly what is needed.
revoke all on public.projects, public.releases, public.project_secrets, public.admins, public.rate_limits
  from anon, authenticated;

grant select on public.projects, public.releases to anon, authenticated;
grant update (hidden) on public.projects to authenticated;   -- admins hide/show
grant delete on public.projects, public.releases to authenticated; -- admins delete

drop policy if exists "read visible projects" on public.projects;
create policy "read visible projects" on public.projects for select
  to anon, authenticated using (not hidden or public.is_admin());

drop policy if exists "admin hides projects" on public.projects;
create policy "admin hides projects" on public.projects for update
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin deletes projects" on public.projects;
create policy "admin deletes projects" on public.projects for delete
  to authenticated using (public.is_admin());

drop policy if exists "read visible releases" on public.releases;
create policy "read visible releases" on public.releases for select
  to anon, authenticated using (
    exists (select 1 from public.projects p
             where p.id = releases.project_id and (not p.hidden or public.is_admin()))
  );

drop policy if exists "admin deletes releases" on public.releases;
create policy "admin deletes releases" on public.releases for delete
  to authenticated using (public.is_admin());

-- Functions run with the rights of their owner, so nobody may call the internal ones directly.
revoke all on function public.check_rate_limit(text, int, interval, boolean) from public, anon, authenticated;
revoke all on function public.nm_object_size(text)                  from public, anon, authenticated;
revoke all on function public.nm_check_file(text, text, text)       from public, anon, authenticated;
revoke all on function public.nm_check_folder(text)                 from public, anon, authenticated;
revoke all on function public.create_project(jsonb, text)           from public;
revoke all on function public.add_release(text, text, jsonb)        from public;
grant execute on function public.create_project(jsonb, text)       to anon, authenticated;
grant execute on function public.add_release(text, text, jsonb)    to anon, authenticated;
revoke all on function public.can_publish(text) from public;
grant execute on function public.can_publish(text) to anon, authenticated;
revoke all on function public.check_release_access(text, text, text) from public;
grant execute on function public.check_release_access(text, text, text) to anon, authenticated;
grant execute on function public.is_admin()                         to anon, authenticated;

-- =====================================================================
-- File storage
-- =====================================================================

-- One public bucket. 50 MB per file at most. If you change the limit, also change nm_check_file above and
-- "maxFileMB" in config.json.
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

-- Everybody may add files, but only in uploads/<uuid>/ and only with these extensions.
drop policy if exists "neomods upload" on storage.objects;
create policy "neomods upload" on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'files'
    and name ~ '^uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
    and name ~* '\.(png|jpe?g|webp|gif|zip|jar|dll|7z|rar)$'
  );

-- Only admins may list or delete files.
drop policy if exists "neomods admin read" on storage.objects;
create policy "neomods admin read" on storage.objects for select
  to authenticated using (bucket_id = 'files' and public.is_admin());

drop policy if exists "neomods admin delete" on storage.objects;
create policy "neomods admin delete" on storage.objects for delete
  to authenticated using (bucket_id = 'files' and public.is_admin());

-- Make the new functions visible to the API right away.
notify pgrst, 'reload schema';

-- =====================================================================
-- LAST STEP, done once by you:
--   1. Supabase dashboard -> Authentication -> Users -> Add user -> enter your e-mail and a password.
--   2. Supabase dashboard -> Authentication -> Sign In / Providers -> turn OFF "Allow new users to sign up".
--   3. Run this line with YOUR e-mail to make that user the admin:
--
--      insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
-- =====================================================================
