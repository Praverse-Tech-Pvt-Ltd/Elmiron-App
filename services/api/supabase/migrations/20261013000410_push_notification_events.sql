-- `BE-W195` (second half) -- the four facts that put a notification in the outbox.
--
-- Each is a trigger on a row that ALREADY records the act, so every path that performs the act --
-- the console, a retried RPC, a reassignment -- notifies, and no client can raise a notification
-- that did not happen:
--
--   1. `day_plan`      -- a MANAGER saved a plan version for a rep's day (`beat_plans` with
--                         `planned_by_user_id`, written by `plan_mr_day` / `reassign_planned_visits`).
--                         DEFERRED to commit: the version's entries are inserted after the version
--                         row, and the count is only true once they are all there. A re-plan of the
--                         same day before the first was sent replaces it (`dedupe_key`).
--   2. `day_reopened`  -- a manager or admin reopened the rep's ended day (`work_day_reopenings`).
--   3. `course_assigned` -- a course was assigned to the person (`course_assignments`).
--   4. `coaching_note` -- a manager recorded an override on the rep's visit analysis
--                         (`analysis_overrides`), the one manager-to-rep coaching act that exists.
--
-- **Nothing is built for the adverse-event path** (`.ai-collab/constraints.md`, "Ask before doing").
--
-- **What a notification says is fixed here, and says only counts and dates** -- never a doctor,
-- clinic, product, course title, reason text or note. The rep opens the app to read the rest, behind
-- their sign-in.
--
-- Rollback: services/api/rollbacks/20261013000410_push_notification_events.down.sql

-- "today", "tomorrow", or "Wed 14 Oct", against the rep's own territory date.
create or replace function public.notification_day_words(p_user_id uuid, p_day date)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_today date;
begin
  begin
    v_today := public.rep_today(p_user_id);
  exception when others then
    v_today := null;
  end;
  if v_today is not null and p_day = v_today then
    return 'today';
  elsif v_today is not null and p_day = v_today + 1 then
    return 'tomorrow';
  end if;
  return to_char(p_day, 'FMDy DD Mon');
end;
$$;

-- 1. A manager's plan version, counted at commit.
create or replace function public.notify_plan_saved()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_count integer;
  v_day   text;
  v_body  text;
  v_today date;
begin
  if new.planned_by_user_id is null or new.planned_by_user_id = new.mr_id then
    return null;
  end if;
  begin
    v_today := public.rep_today(new.mr_id);
  exception when others then
    v_today := null;
  end;
  -- A day that has already ended is history; nobody is told about it.
  if v_today is not null and new.plan_date < v_today then
    return null;
  end if;

  select count(*) into v_count from public.beat_plan_entries e where e.beat_plan_id = new.id;
  v_day := public.notification_day_words(new.mr_id, new.plan_date);
  v_body := case
    when v_count = 0 then format('Your manager cleared your plan for %s.', v_day)
    when new.supersedes_beat_plan_id is null then
      format('Your manager planned %s visit%s for %s.', v_count,
             case when v_count = 1 then '' else 's' end, v_day)
    else format('Your manager updated your plan for %s: %s visit%s.', v_day, v_count,
                case when v_count = 1 then '' else 's' end)
  end;

  perform public.enqueue_notification(
    new.mr_id, 'day_plan',
    case when new.supersedes_beat_plan_id is null then 'Your day is planned' else 'Your plan changed' end,
    v_body, '/beat-plan', 'beat_plans', new.id, 'day_plan:' || new.plan_date::text);
  return null;
end;
$$;

create constraint trigger beat_plans_notify_rep
  after insert on public.beat_plans
  deferrable initially deferred
  for each row
  when (new.planned_by_user_id is not null)
  execute function public.notify_plan_saved();

-- 2. A reopened day.
create or replace function public.notify_work_day_reopened()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.enqueue_notification(
    new.mr_id, 'day_reopened', 'Your day was reopened',
    format('Your working day for %s was reopened. You can record visits again.',
           public.notification_day_words(new.mr_id, new.work_date)),
    '/day-end', 'work_day_reopenings', new.id, null);
  return null;
end;
$$;

create trigger work_day_reopenings_notify_rep
  after insert on public.work_day_reopenings
  for each row execute function public.notify_work_day_reopened();

-- 3. A course assigned. The title is not sent; the app shows it after sign-in.
create or replace function public.notify_course_assigned()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.assigned_by_user_id = new.assignee_user_id then
    return null;
  end if;
  perform public.enqueue_notification(
    new.assignee_user_id, 'course_assigned', 'A new course for you',
    case when new.due_on is null then 'A course was assigned to you. Open Learning to start it.'
         else format('A course was assigned to you, due by %s. Open Learning to start it.',
                     to_char(new.due_on, 'FMDD Mon')) end,
    '/learning', 'course_assignments', new.id, null);
  return null;
end;
$$;

create trigger course_assignments_notify_assignee
  after insert on public.course_assignments
  for each row execute function public.notify_course_assigned();

-- 4. A manager's note on the rep's visit analysis. The note itself is not sent.
create or replace function public.notify_analysis_override()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_mr uuid;
begin
  select a.mr_id into v_mr from public.analyses a where a.id = new.analysis_id;
  if v_mr is null or v_mr = new.overridden_by_user_id then
    return null;
  end if;
  perform public.enqueue_notification(
    v_mr, 'coaching_note', 'A coaching note for you',
    'Your manager added a note to one of your visit reviews.',
    '/analysis/' || new.analysis_id::text, 'analysis_overrides', new.id, null);
  return null;
end;
$$;

create trigger analysis_overrides_notify_rep
  after insert on public.analysis_overrides
  for each row execute function public.notify_analysis_override();

revoke all on function public.notification_day_words(uuid, date) from public, anon, authenticated;
revoke all on function public.notify_plan_saved() from public, anon, authenticated;
revoke all on function public.notify_work_day_reopened() from public, anon, authenticated;
revoke all on function public.notify_course_assigned() from public, anon, authenticated;
revoke all on function public.notify_analysis_override() from public, anon, authenticated;
