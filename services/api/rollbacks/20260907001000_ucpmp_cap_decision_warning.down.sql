-- Rollback for 20260907001000_ucpmp_cap_decision_warning.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores the 20260907000900 body verbatim: the deadline still fails CI on
-- 6 November 2026, and it does so with no warning beforehand. `check:decision-debt`
-- reads `warn` as undefined and simply does not warn, so applying this is safe rather
-- than half-applied -- but the first anybody hears of the deadline is the red build.
--
-- The threshold rows are NOT touched. app_thresholds is append-only and enforced by a
-- statement-level reject_mutation trigger; a delete would be refused with 23001.

create or replace function public.ucpmp_cap_decision_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with v as (
    select public.threshold('ucpmp_sample_cap_quantity') as cap,
           public.threshold('ucpmp_sample_cap_decision_due') as due
  ),
  parsed as (
    select
      (v.cap is not null and jsonb_typeof(v.cap) <> 'null') as cap_configured,
      case
        when v.due is null or jsonb_typeof(v.due) <> 'string' then null
        else (v.due #>> '{}')::timestamptz
      end as due_at
    from v
  )
  select jsonb_build_object(
    'capConfigured', p.cap_configured,
    'dueAt', p.due_at,
    'overdue', not p.cap_configured and (p.due_at is null or p.due_at <= now()),
    'daysRemaining', case
      when p.cap_configured then null
      when p.due_at is null then 0
      else greatest(0, ceil(extract(epoch from (p.due_at - now())) / 86400)::integer)
    end,
    'question', 'What is the UCPMP sample cap, on what dimension, and who at the '
                'client owns that number?'
  )
  from parsed p;
$$;

comment on function public.ucpmp_cap_decision_status() is
  'BE-W21. Whether the UCPMP cap decision is still outstanding and whether its '
  'deadline has passed. Fails closed: a missing deadline reads as overdue, so the '
  'alarm cannot be silenced by deleting the row that carries it. check:decision-debt '
  'turns this into a CI failure; nothing here blocks a sample write or a test run.';
