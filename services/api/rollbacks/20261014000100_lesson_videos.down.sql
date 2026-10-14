-- Rollback for `BE-W208` (20261014000100_lesson_videos).
--
-- What rolling back MEANS: lessons lose their video columns, so every lesson -- published ones
-- included -- goes back to text only, and nobody can read or write the `lesson-videos` bucket through
-- the API any more (no policy is left for it). The course loader's `Video:` / `Poster:` lines
-- (`BE-W210`) and the app's player (`FE-W127`) must be rolled back with this: the loader would write
-- columns that no longer exist, and the app would select them and fail the lesson read.
--
-- The BUCKET and its objects are deliberately NOT removed, as for `audio`: Supabase refuses a SQL
-- delete of storage rows, and a bucket row removed under its objects would orphan them in the storage
-- backend. Empty it through the Storage API (as the service role) first if it must go, then:
--   delete from storage.buckets where id = 'lesson-videos';
--
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>

drop policy if exists lesson_videos_insert_admin_draft on storage.objects;
drop policy if exists lesson_videos_select_readable_lesson on storage.objects;

drop function if exists public.lesson_video_writable(text);
drop function if exists public.lesson_video_readable(text);
drop function if exists public.lesson_video_path_parts(text);

drop trigger if exists lessons_video_object_exists on public.lessons;
drop function if exists public.lessons_video_object_exists();

alter table public.lessons
  drop constraint if exists lessons_video_poster_path_is_this_lessons,
  drop constraint if exists lessons_video_path_is_this_lessons,
  drop constraint if exists lessons_video_duration_needs_video,
  drop constraint if exists lessons_video_poster_needs_video,
  drop constraint if exists lessons_video_duration_positive,
  drop column if exists video_duration_seconds,
  drop column if exists video_poster_path,
  drop column if exists video_object_path;
