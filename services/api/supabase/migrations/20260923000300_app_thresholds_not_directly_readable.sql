-- ============================================================================
-- MR-52 D -- BE-W106: the settings table stops being readable directly, and the
-- acceptance of what remains gets a date.
-- ============================================================================
--
-- MR-51 C1 probed all 19 directly readable tables across the tenant boundary. Eighteen held.
-- `app_thresholds` did not: `app_thresholds_select_authenticated` is `using (true)` and SELECT was
-- granted to `authenticated`, so an MR or an admin of one company read another's territory row --
-- the key, the value, the territory id, and `set_by_user_id`, a user of the other company.
--
-- **This migration does not answer BE-W106.** The question there is a MODEL question -- which
-- settings belong to which company, and whether `scope` grows a third value or the table grows an
-- `organisation_id` -- and it is the operator's (`blocked-on-you` 2.7, unanswered). What it does is
-- remove the direct read, which is the leak, and leave the model exactly as open as it was.
--
-- **Why this breaks nothing, established rather than assumed.** One database object reads the
-- table: `threshold(text, uuid)`, which is `SECURITY DEFINER` owned by `postgres` and therefore
-- unaffected by what `authenticated` may select. No client code reads it at all -- not the app, not
-- the console, not the mock (grepped, MR-52 D2). Every value the app uses already arrives through a
-- function: `my_shift_window()`, `validate_consent_capture`, `begin_upload`'s ceiling.
--
-- **What stays open, unchanged and still `BE-W106`:** `threshold()` returns any territory's value
-- to any caller who names it, and a `global` row is shared by every tenant. That is the model
-- question, now with a deadline attached below rather than an open-ended acceptance.

revoke select on public.app_thresholds from authenticated, anon;
drop policy app_thresholds_select_authenticated on public.app_thresholds;

-- ----------------------------------------------------------------------------
-- MR-52 D4 -- the acceptance expires on a date, the way the UCPMP cap's does.
-- ----------------------------------------------------------------------------
--
-- `check:decision-debt` already exists for exactly this shape and says why: "a non-zero exit from a
-- CI job reaches a person, and a null in a table does not". An accepted gap with no date becomes
-- permanent silently, which is what this prevents.
--
-- **The date is a PROPOSAL for the operator**, and it is 2026-10-31 because that is when the other
-- recorded acceptance in this repository expires -- the production migration-drift acceptance
-- (`--accept-undeployed-until 2026-10-31`). Two accepted gaps coming due on one date is one
-- conversation; two dates drifting apart is two. Moving it is a dated, attributable row, because
-- `app_thresholds` is append-only.
insert into public.app_thresholds (key, value, scope, note)
values (
  'be_w106_settings_model_decision_due',
  '"2026-10-31T00:00:00Z"'::jsonb,
  'global',
  'MR-52 D4. BE-W106: which settings belong to which company. Proposed to the operator, matching '
  || 'the production drift acceptance date. Resolved when app_thresholds carries organisation '
  || 'scoping -- an organisation_id column, or a scope value for it.'
);

/**
 * Is the settings-model question still open, and is its deadline past?
 *
 * **Resolution is detected from the SCHEMA, not from a flag somebody remembers to flip.** The
 * decision, whatever it is, lands as organisation scoping on this table: a column, or a `scope`
 * value. Either makes this report resolved; neither, and the deadline stands.
 *
 * Fails closed on a missing deadline, exactly as `ucpmp_cap_decision_status()` does: the alarm must
 * not be silenceable by deleting the row that carries it.
 */
CREATE OR REPLACE FUNCTION public.be_w106_decision_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with c as (select 21 as warn_days),
  v as (
    select public.threshold('be_w106_settings_model_decision_due') as due,
           (exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'app_thresholds'
                       and column_name = 'organisation_id')
            or exists (select 1 from public.app_thresholds t where t.scope = 'organisation')
           ) as scoped
  ),
  parsed as (
    select
      v.scoped,
      case
        when v.due is null or jsonb_typeof(v.due) <> 'string' then null
        else (v.due #>> '{}')::timestamptz
      end as due_at,
      c.warn_days
    from v, c
  ),
  computed as (
    select
      p.scoped,
      p.due_at,
      p.warn_days,
      (not p.scoped and (p.due_at is null or p.due_at <= now())) as overdue,
      case
        when p.scoped or p.due_at is null then null
        else p.due_at - make_interval(days => p.warn_days)
      end as warn_from_at
    from parsed p
  )
  select jsonb_build_object(
    'settingsScoped', k.scoped,
    'dueAt', k.due_at,
    'overdue', k.overdue,
    'warn', (not k.scoped and k.warn_from_at is not null and k.warn_from_at <= now()
             and not k.overdue),
    'daysRemaining', case when k.due_at is null then null
                          else floor(extract(epoch from k.due_at - now()) / 86400)::integer end)
    from computed k;
$function$;

revoke all on function public.be_w106_decision_status() from public, anon, authenticated;

do $$
declare
  v_status jsonb;
begin
  -- The leak's two halves, asserted gone.
  if has_table_privilege('authenticated', 'public.app_thresholds', 'select') then
    raise exception 'MR-52 D1: app_thresholds is still directly readable by authenticated';
  end if;
  if exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
              where c.relname = 'app_thresholds' and p.polname = 'app_thresholds_select_authenticated') then
    raise exception 'MR-52 D1: the using(true) policy is still there';
  end if;

  -- The one reader must still be able to read, or the values stop reaching the app.
  if public.threshold('be_w106_settings_model_decision_due') is null then
    raise exception 'MR-52 D4: the deadline row is not readable through threshold()';
  end if;

  v_status := public.be_w106_decision_status();
  if (v_status ->> 'dueAt') is null then
    raise exception 'MR-52 D4: the status function reports no deadline';
  end if;
  -- A deadline in the past would mean this migration ships the alarm already ringing.
  if (v_status ->> 'overdue')::boolean then
    raise exception 'MR-52 D4: the proposed deadline is already past: %', v_status;
  end if;
end;
$$;
