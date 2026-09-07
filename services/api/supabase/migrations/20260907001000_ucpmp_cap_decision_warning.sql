-- ============================================================================
-- BE-W21 (3 of 3) · The deadline warns before it fires
--
-- `20260907000900` gave the UCPMP cap decision a deadline that fails CI on
-- 6 November 2026. A red build arriving unannounced on the day is treated as an
-- obstacle -- something in the way of the work somebody was actually doing -- and the
-- first instinct is to get past it. A warning arriving three weeks earlier is treated
-- as a question, which is what it is.
--
-- This is the same reasoning `20260816000200` used for making the shift-window expiry
-- readable before it bites: "a stopgap whose expiry is only discoverable by everything
-- breaking is a worse stopgap than one with a visible date."
--
-- **Twenty-one days**, so the warning starts on 16 October 2026. Long enough to route a
-- question to a client and get an answer back; short enough that the warning is still
-- about this deadline rather than background noise a reader learns to scroll past. It
-- is the last third of the 60-day window, and like the 60 it is borrowed from the
-- shape of the existing decision rather than invented for this one.
--
-- The warning does NOT fail the build. A control that goes red three weeks early has
-- simply moved the deadline and lied about which day it was.
--
-- Rollback: services/api/rollbacks/20260907001000_ucpmp_cap_decision_warning.down.sql
-- ============================================================================

create or replace function public.ucpmp_cap_decision_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select 21 as warn_days),
  v as (
    select public.threshold('ucpmp_sample_cap_quantity') as cap,
           public.threshold('ucpmp_sample_cap_decision_due') as due
  ),
  parsed as (
    select
      (v.cap is not null and jsonb_typeof(v.cap) <> 'null') as cap_configured,
      case
        when v.due is null or jsonb_typeof(v.due) <> 'string' then null
        else (v.due #>> '{}')::timestamptz
      end as due_at,
      c.warn_days
    from v, c
  ),
  computed as (
    select
      p.cap_configured,
      p.due_at,
      p.warn_days,
      -- FAIL CLOSED, unchanged from 20260907000900: a missing deadline reads as
      -- overdue, not as "no deadline". The alarm must not be silenceable by removing
      -- the row that carries it.
      (not p.cap_configured and (p.due_at is null or p.due_at <= now())) as overdue,
      case
        when p.cap_configured or p.due_at is null then null
        else p.due_at - make_interval(days => p.warn_days)
      end as warn_from_at
    from parsed p
  )
  select jsonb_build_object(
    'capConfigured', k.cap_configured,
    'dueAt', k.due_at,
    'overdue', k.overdue,
    'warnFromAt', k.warn_from_at,
    'warnDays', k.warn_days,
    -- Warning and overdue are mutually exclusive on purpose. A caller that treats
    -- `warn` as "not yet serious" must never see it still true on the day the build
    -- goes red, or it will read the red as a warning too.
    'warn', not k.overdue and k.warn_from_at is not null and k.warn_from_at <= now(),
    'daysRemaining', case
      when k.cap_configured then null
      when k.due_at is null then 0
      else greatest(0, ceil(extract(epoch from (k.due_at - now())) / 86400)::integer)
    end,
    'question', 'What is the UCPMP sample cap, on what dimension, and who at the '
                'client owns that number?'
  )
  from computed k;
$$;

comment on function public.ucpmp_cap_decision_status() is
  'BE-W21. Whether the UCPMP cap decision is outstanding, whether its deadline has '
  'passed, and whether it is close enough to warn about (21 days). Fails closed: a '
  'missing deadline reads as overdue, so the alarm cannot be silenced by deleting the '
  'row that carries it. `warn` and `overdue` are mutually exclusive -- a warning that '
  'is still true on the day the build goes red teaches a reader to ignore the red. '
  'check:decision-debt warns without failing, then fails; nothing here blocks a '
  'sample write or a test run.';
