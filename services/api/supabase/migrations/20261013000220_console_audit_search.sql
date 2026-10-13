-- `BE-W188` -- the audit log, searchable: by who, by what, by when, a page at a time.
--
-- **What existed.** `list_audit_log` (`BE-W14`) returns the newest rows of the caller's company,
-- paged by id, and nothing else -- enough for the compliance panel's last 25, not for "what did this
-- admin change last week". It is left exactly as it is: its shape is the contract
-- (`ListAuditLogResponseSchema`) and the compliance panel reads it.
--
-- **The same boundary, unchanged.** `audit_log` has RLS forced and NO policy; this is SECURITY
-- DEFINER and the whole boundary is in its body:
--   * a non-admin is refused through `refuse_read`, so the attempt is itself in the trail;
--   * a reason is required, and the read is audited with it before any row is returned;
--   * rows are the company's: their actor is a profile of the caller's organisation. Rows with no
--     actor belong to no company and are counted, never shown (`systemRowsHidden`, as before);
--   * `ip_address` is not returned (as before).
--
-- **What is new.** Filters on actor, table, action and a date range; the actor's NAME next to their
-- id, which is what makes the trail readable; `nextBeforeId` for the next page; and the list of
-- tables that appear in the company's trail, for the filter.
--
-- The admin check reads the TABLE (`effective_role()`), not the JWT, unlike `list_audit_log`: a
-- deactivated admin's token carries `app_role = admin` for up to an hour.
--
-- Rollback: services/api/rollbacks/20261013000220_console_audit_search.down.sql

create or replace function public.search_audit_log(
  p_reason          text,
  p_limit           integer default 50,
  p_before_id       bigint default null,
  p_actor_id        uuid default null,
  p_table_name      text default null,
  p_action          text default null,
  p_from            timestamptz default null,
  p_until           timestamptz default null,
  p_include_refused boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org      uuid;
  v_action   public.audit_action;
  v_limit    integer;
  v_audit_id bigint;
  v_rows     jsonb;
  v_count    integer;
  v_next     bigint;
  v_hidden   integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.effective_role() is distinct from 'admin' then
    return public.refuse_read(
      'audit_log', null,
      'only an admin may read the audit log',
      'The audit trail names every actor in the organisation. Ask an admin.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to the audit log requires a reason'
      using errcode = '22023',
            hint = 'Say why the trail is being read. The reason is recorded with the read.';
  end if;
  if p_action is not null and p_action not in ('insert', 'update', 'delete', 'select') then
    raise exception 'action_unknown: % is not insert, update, delete or select', p_action
      using errcode = '22023';
  end if;
  if p_from is not null and p_until is not null and p_until < p_from then
    raise exception 'range_invalid: the end of the range is before its start' using errcode = '22023';
  end if;
  v_action := p_action::public.audit_action;
  v_limit  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_org    := public.current_user_organisation_id();

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, public.effective_role(), 'select', 'audit_log', null, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  -- One row more than the page, to know whether there is a next one.
  with page as (
    select l.*
      from public.audit_log l
      join public.user_profiles a on a.id = l.actor_id and a.organisation_id = v_org
     where (p_before_id is null or l.id < p_before_id)
       and (p_actor_id is null or l.actor_id = p_actor_id)
       and (p_table_name is null or l.table_name = p_table_name)
       and (v_action is null or l.action = v_action)
       and (p_from is null or l.occurred_at >= p_from)
       and (p_until is null or l.occurred_at < p_until)
       and (p_include_refused or not l.refused)
     order by l.id desc
     limit v_limit + 1
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'id',         p.id,
           'actorId',    p.actor_id,
           'actorName',  a.full_name,
           'actorRole',  p.actor_role,
           'action',     p.action,
           'tableName',  p.table_name,
           'rowId',      p.row_id,
           'occurredAt', p.occurred_at,
           'reason',     p.reason,
           'refused',    p.refused) order by p.id desc)
           filter (where p.rn <= v_limit), '[]'::jsonb),
         max(p.id) filter (where p.rn = v_limit)
    into v_count, v_rows, v_next
    from (select page.*, row_number() over (order by page.id desc) as rn from page) p
    join public.user_profiles a on a.id = p.actor_id;

  select count(*)::integer into v_hidden from public.audit_log l where l.actor_id is null;

  return jsonb_build_object(
    'data',             v_rows,
    'nextBeforeId',     case when v_count > v_limit then v_next else null end,
    'tables',           coalesce((
                          select jsonb_agg(x.table_name order by x.table_name)
                            from (select distinct l.table_name
                                    from public.audit_log l
                                    join public.user_profiles a
                                      on a.id = l.actor_id and a.organisation_id = v_org) x),
                          '[]'::jsonb),
    'readAt',           clock_timestamp(),
    'auditLogId',       v_audit_id,
    'systemRowsHidden', v_hidden);
end;
$$;

revoke execute on function public.search_audit_log(text, integer, bigint, uuid, text, text, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.search_audit_log(text, integer, bigint, uuid, text, text, timestamptz, timestamptz, boolean) to authenticated;
