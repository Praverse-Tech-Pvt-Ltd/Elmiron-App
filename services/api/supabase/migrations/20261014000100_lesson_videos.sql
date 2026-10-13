-- ============================================================================
-- BE-W208 -- lesson videos: a private bucket, a video on a lesson, and who may read and write it.
-- ============================================================================
--
-- **The owner's decision (14 October 2026).** The client's conference videos -- doctors explaining
-- IC/BPS, PPS, cystoscopy, phenotyping -- are 0.6-4.2 GB each. Trimmed SECTIONS of them
-- (`pnpm video:trim`, `BE-W209`) are kept in Supabase Storage and shown inside LMS lessons, played in
-- the app. This file is the storage half and the rules; the loader (`BE-W210`) puts clips here and the
-- app (`FE-W127`) plays them.
--
-- **What a lesson video IS, in the model `20260924000500_lms_core.sql` already has.** Part of a
-- lesson, exactly like its `body`: written while the course version is a DRAFT, frozen when it is
-- published. Nothing new enforces the freeze -- `lessons_is_draft` (`course_content_is_draft`) already
-- refuses ANY insert, update or delete of a lesson whose version is not a draft, so the three columns
-- below are frozen by the same trigger that freezes `body`. A learner therefore always watches the
-- clip the version they enrolled in carried.
--
-- **The bucket** `lesson-videos` is PRIVATE: no public URL exists. A clip is reached only by a
-- short-lived SIGNED URL, which Storage issues only to a caller whose SELECT on the object passes the
-- policy below -- so RLS decides who can watch, as it decides who can read the lesson's text. 50 MiB per
-- object (the Free plan's per-file limit and `config.toml`'s), `video/mp4` and `image/jpeg` (posters)
-- only.
--
-- **The path convention** -- `<organisation_id>/<course_version_id>/<lesson_id>/<file>` -- is not
-- decoration: the write policy reads it to decide WHICH company's WHICH draft the object belongs to, and
-- the lesson's columns must point inside that lesson's own folder (a CHECK). The file name is chosen by
-- the loader (a content hash), never by a person; nothing about a doctor goes in a path
-- (`constraints.md`, "Opaque, server-generated storage keys").
--
-- **Read** (`lesson_video_readable`): an authenticated user can read an object only if the lesson it
-- belongs to is readable to them by THE SAME RULE the lesson rows use -- `course_version_readable()`:
-- their own organisation, and a published or retired version (admins also drafts). A non-admin can read
-- only the files the lesson actually names (its video and its poster), not something else left in the
-- folder. Assignment is not required, exactly as for the text (`lms_core`: "Assignment is not required
-- to learn").
--
-- **Write** (`lesson_video_writable`): INSERT only, only by an active admin, only into a path whose
-- organisation is theirs, whose version is a DRAFT of their organisation, and whose lesson is in that
-- version. **No UPDATE and no DELETE policy exists for this bucket**, so through the API nobody --
-- admin included -- can overwrite or remove a clip; a published lesson's video cannot be swapped under
-- the learners who watched it. (The owner/service role bypasses RLS, as everywhere; removing a clip is
-- an operator's act through the Storage API, `constraints.md`, "Two systems for any deletion".)
--
-- **The tenant boundary.** Every helper compares with `current_user_organisation_id()`, which is null
-- for anyone with no active profile, and `null = x` admits nothing. `tests/lesson-videos.spec.ts`
-- attacks each rule from another company and with a positive control beside each refusal.

-- ----------------------------------------------------------------------------
-- 1. The video on a lesson
-- ----------------------------------------------------------------------------

alter table public.lessons
  add column video_object_path      text,
  add column video_poster_path      text,
  add column video_duration_seconds integer;

comment on column public.lessons.video_object_path is
  'BE-W208. The lesson''s clip in the lesson-videos bucket: <organisation_id>/<course_version_id>/<lesson_id>/<file>.mp4. Frozen with the version, like body.';
comment on column public.lessons.video_poster_path is
  'BE-W208. The clip''s poster (JPEG) in the same folder; only with a video.';
comment on column public.lessons.video_duration_seconds is
  'BE-W208. The clip''s length as ffprobe measured it at load; null when it could not be measured.';

alter table public.lessons
  add constraint lessons_video_duration_positive
    check (video_duration_seconds is null or video_duration_seconds > 0),
  add constraint lessons_video_poster_needs_video
    check (video_poster_path is null or video_object_path is not null),
  add constraint lessons_video_duration_needs_video
    check (video_duration_seconds is null or video_object_path is not null),
  -- Inside THIS lesson's own folder, so a lesson can never point at another lesson's -- or another
  -- company's -- clip. `organisation_id` and `course_version_id` are set from the module by the BEFORE
  -- trigger, which runs before a CHECK is evaluated.
  add constraint lessons_video_path_is_this_lessons
    check (video_object_path is null or (
      starts_with(video_object_path,
                  organisation_id::text || '/' || course_version_id::text || '/' || id::text || '/')
      and video_object_path ~ '^[^/]+/[^/]+/[^/]+/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.mp4$')),
  add constraint lessons_video_poster_path_is_this_lessons
    check (video_poster_path is null or (
      starts_with(video_poster_path,
                  organisation_id::text || '/' || course_version_id::text || '/' || id::text || '/')
      and video_poster_path ~ '^[^/]+/[^/]+/[^/]+/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.jpg$'));

/**
 * A lesson may name only a clip (and a poster) that is actually in the bucket. Without this a draft
 * could be published pointing at nothing, and every rep would see a player that never loads.
 *
 * Named so it fires AFTER `lessons_is_draft` (triggers of one kind fire in name order), which has
 * already refused a non-draft and derived the organisation and version the path is checked against.
 */
create or replace function public.lessons_video_object_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.video_object_path is not null
     and (tg_op = 'INSERT' or new.video_object_path is distinct from old.video_object_path)
     and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'lesson-videos' and o.name = new.video_object_path) then
    raise exception 'lessons: the video % is not in the lesson-videos bucket; upload it first',
      new.video_object_path
      using errcode = '23514';
  end if;
  if new.video_poster_path is not null
     and (tg_op = 'INSERT' or new.video_poster_path is distinct from old.video_poster_path)
     and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'lesson-videos' and o.name = new.video_poster_path) then
    raise exception 'lessons: the poster % is not in the lesson-videos bucket; upload it first',
      new.video_poster_path
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger lessons_video_object_exists
  before insert or update on public.lessons
  for each row execute function public.lessons_video_object_exists();

-- ----------------------------------------------------------------------------
-- 2. The bucket
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-videos', 'lesson-videos', false, 52428800, array['video/mp4', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = 52428800,
      allowed_mime_types = array['video/mp4', 'image/jpeg'];

-- ----------------------------------------------------------------------------
-- 3. Who may read and write an object -- the path, resolved against the lesson rows
-- ----------------------------------------------------------------------------

/**
 * The three ids and the file name in a lesson-video object path, or nulls when the name does not
 * follow the convention. plpgsql so a malformed name is never cast to uuid (a cast error inside a
 * policy would fail the whole statement, a listing included, rather than exclude one row).
 */
create or replace function public.lesson_video_path_parts(p_name text)
returns table (organisation_id uuid, course_version_id uuid, lesson_id uuid, file_name text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_parts text[];
begin
  v_parts := regexp_match(coalesce(p_name, ''),
    '^(' || c_uuid || ')/(' || c_uuid || ')/(' || c_uuid || ')/([A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(mp4|jpg))$');
  if v_parts is null then
    return;
  end if;
  return query select v_parts[1]::uuid, v_parts[2]::uuid, v_parts[3]::uuid, v_parts[4];
end;
$$;

/**
 * Can the caller read this object? Only if its lesson is readable by the rule the lesson rows use
 * (`course_version_readable`: own organisation; published or retired, or a draft for an admin) -- and,
 * for anyone but an admin, only the video and poster the lesson actually names.
 */
create or replace function public.lesson_video_readable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_path record;
begin
  select * into v_path from public.lesson_video_path_parts(p_name);
  if v_path.lesson_id is null then
    return false;
  end if;
  return exists (
    select 1 from public.lessons l
     where l.id = v_path.lesson_id
       and l.course_version_id = v_path.course_version_id
       and l.organisation_id = v_path.organisation_id
       and l.organisation_id = public.current_user_organisation_id()
       and public.course_version_readable(l.course_version_id)
       and (public.is_admin() or p_name = l.video_object_path or p_name = l.video_poster_path));
end;
$$;

/**
 * Can the caller write this object? Only an active admin, into their own organisation's folder, for a
 * lesson of a DRAFT version of their organisation. A published or retired version's folder is closed.
 */
create or replace function public.lesson_video_writable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_path record;
  v_org  uuid := public.current_user_organisation_id();
begin
  if v_org is null or not public.is_admin() then
    return false;
  end if;
  select * into v_path from public.lesson_video_path_parts(p_name);
  if v_path.lesson_id is null or v_path.organisation_id is distinct from v_org then
    return false;
  end if;
  return exists (
    select 1 from public.lessons l
      join public.course_versions v on v.id = l.course_version_id
     where l.id = v_path.lesson_id
       and v.id = v_path.course_version_id
       and v.organisation_id = v_org
       and l.organisation_id = v_org
       and v.status = 'draft');
end;
$$;

revoke all on function public.lessons_video_object_exists() from public, anon, authenticated;
revoke all on function public.lesson_video_path_parts(text) from public, anon, authenticated;
revoke all on function public.lesson_video_readable(text) from public, anon, authenticated;
revoke all on function public.lesson_video_writable(text) from public, anon, authenticated;
-- A storage policy runs as the caller, so the caller needs EXECUTE on what it calls.
grant execute on function public.lesson_video_path_parts(text) to authenticated;
grant execute on function public.lesson_video_readable(text) to authenticated;
grant execute on function public.lesson_video_writable(text) to authenticated;

create policy lesson_videos_select_readable_lesson
  on storage.objects for select to authenticated
  using (bucket_id = 'lesson-videos' and public.lesson_video_readable(name));

create policy lesson_videos_insert_admin_draft
  on storage.objects for insert to authenticated
  with check (bucket_id = 'lesson-videos' and public.lesson_video_writable(name));

-- Deliberately NO update and NO delete policy for `lesson-videos`: a clip, once stored, is not
-- overwritten or removed through the API by anyone.

-- ----------------------------------------------------------------------------
-- 4. Self-checks
-- ----------------------------------------------------------------------------

do $$
declare
  v_fn text;
begin
  if (select b.public from storage.buckets b where b.id = 'lesson-videos') is distinct from false then
    raise exception 'BE-W208: the lesson-videos bucket must exist and be private';
  end if;
  if exists (select 1 from pg_policies p
              where p.schemaname = 'storage' and p.tablename = 'objects'
                and p.cmd in ('UPDATE', 'DELETE', 'ALL')
                and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%lesson-videos%') then
    raise exception 'BE-W208: lesson-videos must have no update or delete policy';
  end if;
  foreach v_fn in array array['public.lesson_video_readable(text)', 'public.lesson_video_writable(text)',
                              'public.lesson_video_path_parts(text)', 'public.lessons_video_object_exists()'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'BE-W208: % is executable by anon', v_fn;
    end if;
  end loop;
end;
$$;
