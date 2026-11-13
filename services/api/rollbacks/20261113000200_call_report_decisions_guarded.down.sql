-- Rollback for `BE-W221` (20261113000200_call_report_decisions_guarded).
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- What rolling back MEANS: the bulk approval again replaces a decision somebody else has already
-- recorded on a report, without saying so, and a report can again be recorded as not approved
-- with no reason. Both bodies are restored verbatim (`20260917000100`, `20260815000200`). No row
-- changes: decisions recorded meanwhile stay, they are append-only. The console keeps working --
-- it sends the same calls.

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
