-- Rollback for AI-B2 -- removes the LMS core.
--
-- What rolling back MEANS: every course, version, lesson, assignment, enrolment and lesson
-- completion is destroyed -- including completed training history, which the forward migration
-- exists to preserve. Do not run this against a database where anyone has trained unless that
-- loss is the intent. The audit_log rows recording those events are NOT removed (append-only).
-- The client must be rolled back with this if any screen reads these tables.

drop table if exists public.lesson_completions;
drop table if exists public.course_enrolments;
drop table if exists public.course_assignments;
drop table if exists public.lessons;
drop table if exists public.course_modules;
drop table if exists public.course_versions;
drop table if exists public.courses;

drop function if exists public.complete_lesson(uuid, uuid);
drop function if exists public.start_course_version(uuid);
drop function if exists public.cancel_course_assignment(uuid);
drop function if exists public.assign_course(uuid, uuid, date);
drop function if exists public.retire_course_version(uuid);
drop function if exists public.publish_course_version(uuid);
drop function if exists public.lms_caller();
drop function if exists public.course_version_readable(uuid);
drop function if exists public.course_assignments_before_update();
drop function if exists public.course_enrolments_before_update();
drop function if exists public.courses_before_update();
drop function if exists public.course_content_is_draft();
drop function if exists public.course_versions_before_update();
drop function if exists public.course_versions_before_insert();

drop type if exists public.course_version_status;
