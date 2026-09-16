-- ============================================================================
-- BE-W15 - the retention read path, and the 90 becomes ONE number
--
-- MR-38 measured that this did not exist. The console's admin screen says so in its own
-- words today: it refuses to print the retention period because *"printing that here would
-- be this console asserting a policy value it has not been told."* That refusal was
-- correct. This is what tells it.
--
-- ----------------------------------------------------------------------------
-- WHY THIS MIGRATION TOUCHES THE TRIGGER
-- ----------------------------------------------------------------------------
--
-- The retention period lives as a bare literal inside `stamp_audio_retention`:
--
--     new.purge_after := new.received_at + interval '90 days';
--
-- A read path that returned its own `90` would agree with that literal **by luck**, and
-- the two would drift the first time either moved -- which is the whole FIX-03 drift
-- finding, in a schema instead of a mock. So the number becomes a function that both the
-- trigger and the read path call, and there is exactly one `90` in the database.
--
-- `audio_retention_days()` is `immutable`, so the trigger pays nothing for the call.
--
-- ----------------------------------------------------------------------------
-- SCOPING
-- ----------------------------------------------------------------------------
--
-- Admin-only and refusing rather than emptying, for the same reason as `list_audit_log`
-- and stated in the same recorded check. **The figures themselves are per-organisation**:
-- `audio_purge_health()` is a whole-database view granted to nobody, so this does not call
-- it -- it computes the same shape from rows whose MR is in
-- `public.visible_user_ids()`, which is BE-W76's boundary. An admin of one tenant is told
-- about their own tenant's audio and no other's.
--
-- The period is not tenant-scoped, because it is a property of the system rather than of a
-- customer. It is returned to every admin identically, which is what makes it safe for the
-- console to print.
--
-- Rollback: services/api/rollbacks/20260916000300_retention_read_path.down.sql
-- ============================================================================

create or replace function public.audio_retention_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 90 $$;

comment on function public.audio_retention_days() is
  'BE-W15. The audio retention period, in days, as ONE number. Both '
  'stamp_audio_retention() and retention_status() read it, so the figure the console '
  'prints and the figure the trigger enforces cannot drift apart.';

-- The trigger now reads the same number rather than carrying its own copy.
create or replace function public.stamp_audio_retention()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.received_at := clock_timestamp();
  -- BE-W15: was `interval '90 days'` inline. One number, two readers.
  new.purge_after := new.received_at + make_interval(days => public.audio_retention_days());
  return new;
end;
$$;

create or replace function public.retention_status(p_reason text default null)
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
  v_live     integer;
  v_overdue  integer;
  v_destroyed integer;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role is distinct from 'admin' then
    raise exception 'only an admin may read retention status'
      using errcode = '42501',
            hint = 'These figures count another person''s recordings. Ask an admin.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to retention status requires a reason'
      using errcode = '22023',
            hint = 'Say why the figures are being read. The reason is recorded with the read.';
  end if;

  -- Reading these figures is a read of other people's recordings in aggregate, so it is
  -- audited on the same terms as the audit log itself and for the same reason.
  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, v_role, 'select', 'recordings', null, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  -- Tenant-bounded through visible_user_ids(), NOT from audio_purge_health(), which is a
  -- whole-database view and is granted to nobody for exactly that reason.
  select
    count(*) filter (where r.purge_state <> 'destroyed'),
    count(*) filter (where r.purge_state <> 'destroyed' and r.purge_after < now()),
    count(*) filter (where r.purge_state = 'destroyed')
  into v_live, v_overdue, v_destroyed
  from public.recordings r
  where r.mr_id in (select public.visible_user_ids());

  return jsonb_build_object(
    'retentionDays', public.audio_retention_days(),
    'liveCount', coalesce(v_live, 0),
    'overdueCount', coalesce(v_overdue, 0),
    'destroyedCount', coalesce(v_destroyed, 0),
    'purgeStalled', public.audio_purge_is_stalled(),
    'readAt', clock_timestamp(),
    'auditLogId', v_audit_id
  );
end;
$$;

comment on function public.retention_status(text) is
  'BE-W15. The console''s retention figures: the period from audio_retention_days() and '
  'per-tenant counts scoped through visible_user_ids(). Admin-only, refusing rather than '
  'emptying, and audited like any other read of somebody else''s records.';

revoke execute on function public.retention_status(text) from public;
grant  execute on function public.retention_status(text) to authenticated;
revoke execute on function public.audio_retention_days() from public;
grant  execute on function public.audio_retention_days() to authenticated;
