-- ============================================================================
-- `BE-W221` -- a call-report decision is not replaced by accident, and a rejection says why
-- ============================================================================
--
-- WHAT WAS OPEN -- two things `FE-W200`/`FE-W201` (the console's approval screens) made reachable
--
-- 1. **A stale list overturned a colleague's decision.** `approve_call_report` supersedes any
--    earlier decision by design ("a change of mind is a new row"). The console's queue is drawn
--    once; manager A opens a report from it and records "not approved" with a reason; manager B,
--    whose queue was drawn before that, ticks the same report and approves it. B is told
--    "Approved", A's rejection is superseded, and neither knows. Nothing was wrong with the
--    superseding rule -- only with applying it from a list that showed the report as undecided.
--
-- 2. **"Not approved" needed no reason.** The console asked for three characters; the function
--    accepted `p_approved = false` with a null reason, and so did the bulk call.
--
-- THE FIX
--
-- * `approve_call_reports_bulk` refuses, per row, a report that already has a decision. It is the
--   call for clearing what is WAITING; the row's verdict says to open the report. One refusal does
--   not roll back the others (unchanged).
-- * `approve_call_report` refuses a rejection with a blank reason (`22023`). It still supersedes:
--   a deliberate change of mind, on the report's own page, is the designed path.
--
-- Same names, arguments, return shapes and grants (`create or replace` keeps the ACL). Decisions
-- stay append-only; nothing is rewritten.
--
-- Rollback: services/api/rollbacks/20261113000200_call_report_decisions_guarded.down.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_call_report(p_call_report_id uuid, p_approved boolean, p_reason text DEFAULT NULL::text)
 RETURNS call_report_approvals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid;
  v_role   public.app_role;
  v_report public.call_reports%rowtype;
  v_row    public.call_report_approvals%rowtype;
  v_prior  uuid;
begin
  v_uid  := (select auth.uid());
  v_role := public.effective_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role not in ('field_manager', 'admin') then
    raise exception 'only a field_manager or admin may decide a call report'
      using errcode = '42501';
  end if;

  select * into v_report
    from public.call_reports cr
   where cr.id = p_call_report_id
     and cr.mr_id in (select public.visible_user_ids());

  if v_report.id is null then
    raise exception 'call report % is not in your scope', p_call_report_id using errcode = '42501';
  end if;

  if v_report.mr_id = v_uid then
    raise exception 'the author of a call report may not decide it' using errcode = '42501';
  end if;

  -- `BE-W221`. "Not approved" with no reason is a rejection nobody can act on, and the console was
  -- the only thing asking for one. Checked after the scope checks, so it says nothing about a
  -- report the caller may not decide.
  if p_approved is not true and coalesce(btrim(p_reason), '') = '' then
    raise exception 'a call report that is not approved needs a reason'
      using errcode = '22023',
            hint = 'Say what is wrong with the report. The reason is kept with the decision.';
  end if;

  if v_report.status <> 'submitted' then
    raise exception 'call report % is %; only a submitted report can be decided',
      p_call_report_id, v_report.status using errcode = '22023';
  end if;

  if exists (select 1 from public.call_reports newer
              where newer.supersedes_call_report_id = p_call_report_id) then
    raise exception 'call report % has been superseded by a newer version', p_call_report_id
      using errcode = '22023';
  end if;

  -- A change of mind is a new row referencing the previous decision.
  select ap.id into v_prior
    from public.call_report_approvals ap
   where ap.call_report_id = p_call_report_id
   order by ap.decided_at desc
   limit 1;

  insert into public.call_report_approvals
    (call_report_id, decided_by_user_id, approved, reason, supersedes_approval_id)
  values
    (p_call_report_id, v_uid, p_approved, p_reason, v_prior)
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.approve_call_reports_bulk(
  p_call_report_ids uuid[],
  p_approved        boolean,
  p_reason          text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_limit constant integer := 200;
  v_total   integer;
  v_ids     uuid[];
  v_id      uuid;
  v_results jsonb := '[]'::jsonb;
  v_decided integer := 0;
  v_failed  integer := 0;
  v_message text;
begin
  v_total := coalesce(array_length(p_call_report_ids, 1), 0);

  if v_total = 0 then
    raise exception 'no call reports supplied' using errcode = '22023';
  end if;

  -- Decide the first N and say so, rather than raising and deciding none or
  -- capping and saying nothing.
  v_ids := p_call_report_ids[1:c_limit];

  foreach v_id in array v_ids loop
    begin
      -- `BE-W221`. The bulk call clears reports that are WAITING. One that already has a decision
      -- is not waiting: it was decided -- perhaps not approved, with a reason -- after this
      -- caller's list was drawn, and approving it from that stale list replaced a colleague's
      -- decision without either of them knowing. A change of mind stays possible, one report at a
      -- time, on the report's own page, where the existing decision is on screen.
      -- Only for a report the caller may decide: for any other id the scope refusal below answers,
      -- so this says nothing about a report outside the caller's team or company.
      if public.effective_role() in ('field_manager', 'admin')
         and exists (select 1
                       from public.call_report_approvals ap
                       join public.call_reports cr on cr.id = ap.call_report_id
                      where ap.call_report_id = v_id
                        and cr.mr_id in (select public.visible_user_ids())) then
        raise exception 'call report % already has a decision; open the report to change it', v_id
          using errcode = '22023';
      end if;
      perform public.approve_call_report(v_id, p_approved, p_reason);
      v_results := v_results || jsonb_build_object('id', v_id, 'decided', true, 'error', null);
      v_decided := v_decided + 1;
    exception when others then
      get stacked diagnostics v_message = message_text;
      v_results := v_results || jsonb_build_object('id', v_id, 'decided', false, 'error', v_message);
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'results', v_results,
    'decidedCount', v_decided,
    'notDecidedCount', v_failed,
    'submittedCount', v_total,
    'truncated', v_total > c_limit,
    'limit', c_limit,
    'serverTime', clock_timestamp());
end;
$$;


-- The guard -- fails the deploy if either `create or replace` kept an older body.
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'approve_call_report'
                    and position('needs a reason' in p.prosrc) > 0) then
    raise exception 'BE-W221: approve_call_report does not require a reason for a rejection';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'approve_call_reports_bulk'
                    and position('already has a decision' in p.prosrc) > 0
                    and position('approve_call_report(v_id' in p.prosrc) > 0) then
    raise exception 'BE-W221: approve_call_reports_bulk does not refuse a decided report';
  end if;
end;
$$;
