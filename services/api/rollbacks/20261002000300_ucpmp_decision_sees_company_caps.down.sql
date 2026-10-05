-- Restores ucpmp_cap_decision_status() to its body before 20261002000300_ucpmp_decision_sees_company_caps: only a GLOBAL cap counts.
-- Captured with pg_get_functiondef before the change.

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
$function$;
