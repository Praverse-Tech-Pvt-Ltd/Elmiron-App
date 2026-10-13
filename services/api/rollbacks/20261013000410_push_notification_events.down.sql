-- Rollback for 20261013000410_push_notification_events.sql (`BE-W195`, second half)
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- WHAT ROLLING BACK MEANS: planning a day, reopening a day, assigning a course and a manager's note
-- on an analysis stop putting anything in `notification_outbox`. Nothing they wrote changes. Rows
-- already in the outbox stay (they go with `20261013000400`'s rollback, if that is applied too).

drop trigger if exists analysis_overrides_notify_rep on public.analysis_overrides;
drop trigger if exists course_assignments_notify_assignee on public.course_assignments;
drop trigger if exists work_day_reopenings_notify_rep on public.work_day_reopenings;
drop trigger if exists beat_plans_notify_rep on public.beat_plans;

drop function if exists public.notify_analysis_override();
drop function if exists public.notify_course_assigned();
drop function if exists public.notify_work_day_reopened();
drop function if exists public.notify_plan_saved();
drop function if exists public.notification_day_words(uuid, date);
