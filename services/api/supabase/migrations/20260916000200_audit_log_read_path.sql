-- ============================================================================
-- BE-W14 - the audit log read path
--
-- MR-38 measured that this did not exist: the only `public` functions matching
-- `%audit%` were `write_audit_row` and `stamp_audio_retention`, both writers. The
-- recorded check for this item is two clauses and only the cheap one had ever been run
-- (`grep -c "auditLog" endpoints.ts` -> >=1), which matched a prose comment and the
-- `auditLogId` field on the *analysis overrides* response. A grep locates; it does not
-- decide.
--
-- ----------------------------------------------------------------------------
-- WHAT READING AN APPEND-ONLY LOG IMPLIES, AND WHAT THIS DOES ABOUT IT
-- ----------------------------------------------------------------------------
--
-- `audit_log` is append-only, defended by the statement-level `audit_log_reject_mutation`
-- trigger, with RLS enabled AND forced and **no SELECT policy at all**. Three consequences
-- shape this function:
--
-- 1. **The read must be SECURITY DEFINER**, because there is no policy that could grant
--    it. That moves the whole boundary into this body, so the scoping below is not a
--    convenience -- it is the only thing standing between an admin and another tenant's
--    trail.
--
-- 2. **It must not weaken the append-only property.** It only SELECTs and INSERTs. The
--    rejection trigger is untouched, and nothing here can update or delete a row.
--
-- 3. **Reading the audit log is itself an auditable act, so this writes its own row
--    first.** That makes the read SELF-REFERENTIAL on purpose: every read appends a row
--    that the next read will see, so "who looked at the trail" is in the trail. The row is
--    written BEFORE the data is gathered, which is the same order `list_consent_records`
--    and `read_analysis` use -- a read that failed half way still leaves the evidence that
--    it was attempted.
--
-- **What is NOT audited, stated rather than left to be discovered:** a REFUSED read. The
-- refusal raises, which rolls back the audit row written in the same transaction, so a
-- non-admin rattling the handle leaves no trace here. Recording that would need an
-- autonomous transaction, which this schema has nowhere else and which would be a
-- mechanism invented for one case.
--
-- ----------------------------------------------------------------------------
-- SCOPING - BE-W76's BOUNDARY, AND WHY `visible_user_ids()` IS ENOUGH
-- ----------------------------------------------------------------------------
--
-- `audit_log` has no `organisation_id`. A row's tenant is its ACTOR's tenant, so the scope
-- is `actor_id in (select public.visible_user_ids())` -- and that function has been
-- tenant-bounded for an admin since MR-06 / BE-W76, which replaced
-- "every user profile in every tenant" with "every profile in MINE".
--
-- **There is deliberately no `or v_role = 'admin'` escape here.** `list_consent_records`
-- has one, written before BE-W76; adding the same escape to a new function would reopen
-- the boundary this console is the first surface to exercise in anger.
--
-- **Rows with a NULL actor are excluded, and that is a decision.** A system-written row
-- has no profile and therefore no organisation, so it cannot be shown to one tenant
-- without being shown to all of them. They are counted in `systemRowsHidden` so the reader
-- knows the page is not the whole table rather than inferring it from a short list.
--
-- ----------------------------------------------------------------------------
-- WHY A NON-ADMIN IS REFUSED RATHER THAN GIVEN AN EMPTY PAGE
-- ----------------------------------------------------------------------------
--
-- The recorded check for BE-W14 requires it in so many words: *"an RLS test proves a
-- non-admin gets `permission denied`, not an empty list."* An empty list is a claim that
-- there is nothing to see; a refusal is a claim about who is asking. They are different
-- statements and only one of them is true.
--
-- Rollback: services/api/rollbacks/20260916000200_audit_log_read_path.down.sql
-- ============================================================================

create or replace function public.list_audit_log(
  p_limit     integer default 100,
  p_before_id bigint  default null,
  p_reason    text    default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_role     public.app_role;
  v_audit_id bigint;
  v_rows     jsonb;
  v_hidden   integer;
  v_limit    integer;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- The refusal the recorded check names. Before the audit row, because a refused read
  -- is not a read.
  if v_role is distinct from 'admin' then
    raise exception 'only an admin may read the audit log'
      using errcode = '42501',
            hint = 'The audit trail names every actor in the organisation. Ask an admin.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to the audit log requires a reason'
      using errcode = '22023',
            hint = 'Say why the trail is being read. The reason is recorded with the read.';
  end if;

  -- Bounded here rather than trusted. 500 is `list_sync_rejections`'s ceiling and this
  -- follows it rather than inventing a second number.
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, v_role, 'select', 'audit_log', null, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  -- Keys are built EXPLICITLY in camelCase rather than with `to_jsonb(row)`.
  --
  -- `list_analysis_overrides` uses `to_jsonb(o)` and therefore emits `analysis_id`,
  -- `finding_id`, `overridden_by_user_id`, `created_at` -- while `AnalysisOverrideSchema`
  -- in `packages/core` declares `analysisId`, `findingId`, `overriddenByUserId`,
  -- `createdAt`, and the mock's fixtures are typed to the schema. The database and the
  -- contract disagree about the shape of the same endpoint, which is the FIX-03 drift
  -- that migration's own comment says it closed. Registered in COMPLETION-PLAN as
  -- BE-W95; not repeated here.
  select coalesce(jsonb_agg(entry order by (entry ->> 'id')::bigint desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id',         l.id,
               'actorId',    l.actor_id,
               'actorRole',  l.actor_role,
               'action',     l.action,
               'tableName',  l.table_name,
               'rowId',      l.row_id,
               'occurredAt', l.occurred_at,
               'requestId',  l.request_id,
               'reason',     l.reason
             ) as entry
        from public.audit_log l
       where l.actor_id in (select public.visible_user_ids())
         and (p_before_id is null or l.id < p_before_id)
       order by l.id desc
       limit v_limit
    ) rows;

  -- Named rather than silently dropped: the reader is told the page is not the whole
  -- table. `ip_address` is deliberately not returned -- it is in the trail for an
  -- investigator with database access, not for a console screen.
  select count(*)::integer
    into v_hidden
    from public.audit_log l
   where l.actor_id is null;

  return jsonb_build_object(
    'data', v_rows,
    'readAt', clock_timestamp(),
    'auditLogId', v_audit_id,
    'systemRowsHidden', v_hidden
  );
end;
$$;

comment on function public.list_audit_log(integer, bigint, text) is
  'BE-W14. The console''s view of audit_log, admin-only and tenant-bounded through '
  'visible_user_ids(). Writes its own audit row before returning: reading the trail is '
  'itself in the trail. Rows with a null actor have no tenant and are excluded, counted '
  'in systemRowsHidden.';

revoke execute on function public.list_audit_log(integer, bigint, text) from public;
grant  execute on function public.list_audit_log(integer, bigint, text) to authenticated;
