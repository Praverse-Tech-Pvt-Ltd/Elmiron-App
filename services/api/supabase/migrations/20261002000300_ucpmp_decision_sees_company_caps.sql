-- W1-V B (`BE-W141`) — the UCPMP deadline sees a cap set for a COMPANY.
--
-- Operator item 15: settings belong to each company. Item 14: the operator will supply the number.
-- `ucpmp_cap_decision_status()` is what `check:decision-debt` reads in CI, with no signed-in caller,
-- so `threshold()` resolved only the GLOBAL row. Proved W1-U: with a company cap set it still reported
-- `capConfigured: false` — the 6 November build failure would have fired after the answer arrived.
--
-- Now a cap counts as configured when it is set globally OR for any company. The question this alarm
-- carries is "what is the number", and a company row answers it; whether EVERY company has one is a
-- different question this alarm never asked. Everything else is unchanged and still fails closed:
-- no cap anywhere still warns and still fails on the date; a missing deadline still reads as overdue.
--
-- Generated from pg_get_functiondef of the installed function, one fragment replaced.
-- create or replace keeps the existing grant (authenticated).

CREATE OR REPLACE FUNCTION public.ucpmp_cap_decision_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with c as (select 21 as warn_days),
  v as (
    select public.threshold('ucpmp_sample_cap_quantity') as cap,
           public.threshold('ucpmp_sample_cap_decision_due') as due
  ),
  parsed as (
    select
      -- W1-V B (`BE-W141`). A cap set for a COMPANY answers the question too. This function runs in CI
      -- with no caller, so `threshold()` sees only the global row; before this, a company's cap left
      -- the deadline standing and the build failing on 6 November with the number supplied.
      ((v.cap is not null and jsonb_typeof(v.cap) <> 'null')
       or exists (select 1 from public.app_thresholds t
                   where t.key = 'ucpmp_sample_cap_quantity'
                     and t.organisation_id is not null
                     and t.effective_from <= now()
                     and jsonb_typeof(t.value) <> 'null')) as cap_configured,
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
$function$;
