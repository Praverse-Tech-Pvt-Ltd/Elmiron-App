-- Rollback for `BE-W215` (20261014000200_adverse_event_admin_read).
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- What rolling back MEANS, said plainly because half of it is a defect coming back:
--   * nobody but the filing rep can read a flagged adverse event again -- no admin list, no admin
--     read; the console screen built on `list_adverse_events` / `read_adverse_event` must be rolled
--     back with this, or it will call functions that no longer exist;
--   * `adverse_event_clock_summary()` counts EVERY organisation's reports again, for ANY signed-in
--     user of any tenant. That is the cross-tenant leak this migration closed, restored exactly as
--     `20260816000500` defined it.
--
-- No row changes: the reads these functions recorded stay in `audit_log`, which is append-only.

drop function if exists public.read_adverse_event(uuid, text);
drop function if exists public.list_adverse_events(text, integer, timestamptz, uuid);

-- The original body, verbatim from 20260816000500_adverse_events.sql. `create or replace` may change
-- the language and the volatility back; the ACL is kept, and restated below as it stood.
create or replace function public.adverse_event_clock_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total',            (select count(*) from public.adverse_event_reports),
    'overdueCount',     (select count(*) from public.adverse_event_reports
                          where statutory_due_at <= now()),
    'dueWithin24Hours', (select count(*) from public.adverse_event_reports
                          where statutory_due_at > now()
                            and statutory_due_at <= now() + interval '24 hours'),
    'nextDueAt',        (select min(statutory_due_at) from public.adverse_event_reports
                          where statutory_due_at > now()),
    'oldestOverdueAt',  (select min(statutory_due_at) from public.adverse_event_reports
                          where statutory_due_at <= now()));
$$;

comment on function public.adverse_event_clock_summary() is null;

revoke all on function public.adverse_event_clock_summary() from public, anon;
grant execute on function public.adverse_event_clock_summary() to authenticated;
