-- ============================================================================
-- BE-W4 (2 of 2) · Offline sync
--
-- The shape of the problem: an MR works a full day underground and syncs at 6pm.
-- Everything here follows from that one sentence.
--
--   * Partial success is normal. One item failing must not roll back the others.
--   * A poison item must never block the queue behind it.
--   * A rejected item is a durable state with a machine-readable reason, not a
--     discarded row and a toast the MR never sees.
--
-- The last one is the one that hurts real people. An MR captures eight visits, and
-- at 6pm three are refused because the shift window was configured wrong. They did
-- the work. They cannot re-do the day. So a rejection is recorded, attributable,
-- explainable, and shaped so a manager override can be added later without a
-- migration.
--
-- Rollback: services/api/rollbacks/20260813000200_offline_sync.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tighten visit creation before sync starts writing visits
-- ----------------------------------------------------------------------------

-- The BE-W2 policy checked ownership only, so an MR could file a visit against a
-- doctor outside their territory. "Is this doctor in my scope" IS expressible as a
-- policy, so it stays a policy rather than moving behind an RPC.
drop policy if exists visits_insert_own on public.visits;

create policy visits_insert_own
  on public.visits for insert to authenticated
  with check (
    mr_id = (select auth.uid())
    and doctor_id in (
      select d.id from public.doctors d
       where d.territory_id in (select public.current_user_visible_territory_ids())
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Status and reason vocabularies
-- ----------------------------------------------------------------------------

-- Mirrors SyncEntity in packages/core. voice_note and recording are declared here
-- but refused by apply_sync_item until the audio storage layer lands in week 7 —
-- declaring them now means the client's queue can hold them without the enum
-- changing later.
create type public.sync_entity_kind as enum (
  'visit',
  'check_in',
  'check_out',
  'call_report',
  'consent_record',
  'voice_note',
  'recording',
  'sample_and_input'
);

create type public.sync_item_status as enum (
  'accepted',
  'duplicate',
  'rejected',
  'dead_lettered'
);

-- Machine-readable, so the app can tell "your shift window is misconfigured" from
-- "you were 40km from the clinic". One is somebody else's mistake and one is yours,
-- and an MR being told the wrong one is how trust in the app dies.
create type public.sync_rejection_code as enum (
  'outside_shift_window',
  'outside_geofence',
  'not_your_record',
  'missing_reference',
  'validation_failed',
  'unsupported_entity',
  'malformed_item',
  'internal_error'
);

-- ----------------------------------------------------------------------------
-- 3. Batches and items
-- ----------------------------------------------------------------------------

create table public.sync_batches (
  -- Device-generated. Re-submitting a batch is safe.
  id           uuid primary key,
  mr_id        uuid not null references public.user_profiles (id) on delete restrict,
  item_count   integer not null check (item_count >= 0),
  submitted_at timestamptz not null,
  received_at  timestamptz not null default clock_timestamp(),
  created_at   timestamptz not null default now()
);

create index sync_batches_mr_idx on public.sync_batches (mr_id, received_at desc);

create trigger sync_batches_stamp_received_at
  before insert on public.sync_batches
  for each row execute function public.stamp_received_at();

create table public.sync_items (
  -- Device-generated, and the idempotency key. Retrying is always safe.
  id                uuid primary key,
  batch_id          uuid references public.sync_batches (id) on delete set null,
  mr_id             uuid not null references public.user_profiles (id) on delete restrict,
  entity            public.sync_entity_kind not null,
  operation         text not null check (operation in ('create', 'update')),
  entity_id         uuid not null,
  payload           jsonb not null,
  status            public.sync_item_status not null,
  rejection_code    public.sync_rejection_code,
  rejection_detail  text,
  -- Accepted, but with something the MR should know. `stale_beat_plan` means the
  -- manager revised the plan while they were offline: the work stands, the plan
  -- moved. Neither is discarded.
  warnings          text[] not null default '{}',
  attempt_count     integer not null default 1 check (attempt_count >= 1),
  client_created_at timestamptz not null,
  received_at       timestamptz not null default clock_timestamp(),
  resolved_at       timestamptz,
  -- Not built: a manager override of a rejection would be a NEW item referencing
  -- the rejected one, exactly like a consent withdrawal. The column exists so that
  -- adding it later is code, not a migration against a table with real data in it.
  supersedes_sync_item_id uuid references public.sync_items (id) on delete restrict,
  created_at        timestamptz not null default now(),
  -- A dead letter carries the code it died of, so this is not a biconditional on
  -- `rejected` alone. Found by the dead-lettering test, not by reading it back.
  constraint sync_items_rejection_has_code
    check (
      case status
        when 'rejected'      then rejection_code is not null
        when 'dead_lettered' then rejection_code is not null
        else rejection_code is null
      end
    ),
  constraint sync_items_no_self_supersede
    check (supersedes_sync_item_id is null or supersedes_sync_item_id <> id)
);

create index sync_items_mr_status_idx on public.sync_items (mr_id, status, received_at desc);
create index sync_items_batch_idx     on public.sync_items (batch_id);
create index sync_items_unresolved_idx on public.sync_items (mr_id, client_created_at)
  where status in ('rejected', 'dead_lettered');

comment on table public.sync_items is
  'One row per queued item per device. The id is the idempotency key. A rejection '
  'is a durable state with a machine-readable code, never a discarded row.';

-- ----------------------------------------------------------------------------
-- 4. Applying one item
-- ----------------------------------------------------------------------------

-- Split out so sync_push can call it inside a per-item exception block. Everything
-- it raises is caught and turned into a rejection code by the caller.
create or replace function public.apply_sync_item(
  p_entity    public.sync_entity_kind,
  p_entity_id uuid,
  p_payload   jsonb
)
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_warnings text[] := '{}';
  v_beat_plan uuid;
begin
  v_uid := (select auth.uid());

  case p_entity
    when 'visit' then
      v_beat_plan := nullif(p_payload ->> 'beatPlanId', '')::uuid;
      if v_beat_plan is not null and public.beat_plan_is_stale(v_beat_plan) then
        -- The manager revised the plan while this MR was offline. Their work is
        -- valid; the plan is stale. Warn, never reject.
        v_warnings := array_append(v_warnings, 'stale_beat_plan');
      end if;

      insert into public.visits (id, mr_id, doctor_id, beat_plan_id, clinic_address_id,
                                 status, scheduled_for, started_at, completed_at)
      values (p_entity_id,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              v_beat_plan,
              nullif(p_payload ->> 'clinicAddressId', '')::uuid,
              coalesce(nullif(p_payload ->> 'status', ''), 'planned')::public.visit_status,
              nullif(p_payload ->> 'scheduledFor', '')::timestamptz,
              nullif(p_payload ->> 'startedAt', '')::timestamptz,
              nullif(p_payload ->> 'completedAt', '')::timestamptz)
      on conflict (id) do nothing;

    when 'check_in' then
      perform public.record_check_in(
        p_entity_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload ->> 'latitude')::double precision,
        (p_payload ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

    when 'check_out' then
      perform public.record_check_out(
        p_entity_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload ->> 'latitude')::double precision,
        (p_payload ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

    when 'call_report' then
      if nullif(p_payload ->> 'supersedesCallReportId', '') is not null then
        perform public.revise_call_report(
          p_entity_id,
          (p_payload ->> 'supersedesCallReportId')::uuid,
          coalesce(p_payload ->> 'summary', ''),
          coalesce((select array_agg(value::text::uuid)
                      from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                   '{}'::uuid[]),
          nullif(p_payload ->> 'objectionsRaised', ''),
          nullif(p_payload ->> 'nextStep', ''),
          coalesce(nullif(p_payload ->> 'status', ''), 'submitted')::public.call_report_status);
      else
        insert into public.call_reports (id, visit_id, mr_id, summary, product_ids_discussed,
                                         objections_raised, next_step, status, draft_source)
        values (p_entity_id,
                (p_payload ->> 'visitId')::uuid,
                v_uid,
                coalesce(p_payload ->> 'summary', ''),
                coalesce((select array_agg(value::text::uuid)
                            from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                         '{}'::uuid[]),
                nullif(p_payload ->> 'objectionsRaised', ''),
                nullif(p_payload ->> 'nextStep', ''),
                coalesce(nullif(p_payload ->> 'status', ''), 'draft')::public.call_report_status,
                coalesce(nullif(p_payload ->> 'draftSource', ''), 'manual')::public.call_report_draft_source)
        on conflict (id) do nothing;
      end if;

    when 'consent_record' then
      insert into public.consent_records (id, visit_id, doctor_id, captured_by_mr_id, outcome,
                                          not_asked_reason, consent_text_version_id,
                                          displayed_language, supersedes_consent_record_id,
                                          is_withdrawal, captured_at)
      values (p_entity_id,
              (p_payload ->> 'visitId')::uuid,
              (p_payload ->> 'doctorId')::uuid,
              v_uid,
              (p_payload ->> 'outcome')::public.consent_outcome,
              nullif(p_payload ->> 'notAskedReason', ''),
              (p_payload ->> 'consentTextVersionId')::uuid,
              p_payload ->> 'displayedLanguage',
              nullif(p_payload ->> 'supersedesConsentRecordId', '')::uuid,
              coalesce((p_payload ->> 'isWithdrawal')::boolean, false),
              (p_payload ->> 'capturedAt')::timestamptz)
      on conflict (id) do nothing;

    when 'sample_and_input' then
      insert into public.samples_and_inputs (id, visit_id, mr_id, doctor_id, kind, item_name,
                                             quantity, declared_value_inr, occurred_at)
      values (p_entity_id,
              (p_payload ->> 'visitId')::uuid,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              (p_payload ->> 'kind')::public.sample_or_input_kind,
              p_payload ->> 'itemName',
              (p_payload ->> 'quantity')::integer,
              coalesce((p_payload ->> 'declaredValueInr')::numeric, 0),
              (p_payload ->> 'occurredAt')::timestamptz)
      on conflict (id) do nothing;

    else
      -- voice_note and recording arrive in week 7 with the audio storage layer.
      raise exception 'entity % is not yet accepted by sync', p_entity
        using errcode = '0A000';
  end case;

  return v_warnings;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. sync_push
-- ----------------------------------------------------------------------------

-- Five attempts, then the item is dead-lettered and stops being retried. Nothing
-- is ever blocked behind it: each item is applied in its own exception block, which
-- is its own savepoint, so a failure rolls back that item and nothing else.
create or replace function public.sync_push(p_batch_id uuid, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_attempts constant integer := 5;
  v_uid       uuid;
  v_item      jsonb;
  v_item_id   uuid;
  v_entity    public.sync_entity_kind;
  v_entity_id uuid;
  v_existing  public.sync_items%rowtype;
  v_attempts  integer;
  v_status    public.sync_item_status;
  v_code      public.sync_rejection_code;
  v_detail    text;
  v_warnings  text[];
  v_results   jsonb := '[]'::jsonb;
  v_sqlstate  text;
  v_message   text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a json array' using errcode = '22023';
  end if;

  insert into public.sync_batches (id, mr_id, item_count, submitted_at)
  values (p_batch_id, v_uid, jsonb_array_length(p_items), now())
  on conflict (id) do nothing;

  for v_item in select value from jsonb_array_elements(p_items) value loop
    v_status   := null;
    v_code     := null;
    v_detail   := null;
    v_warnings := '{}';

    -- Malformed items are their own rejection, not an internal error. A device
    -- that has been upgraded mid-queue will produce them.
    begin
      v_item_id   := (v_item ->> 'id')::uuid;
      v_entity    := (v_item ->> 'entity')::public.sync_entity_kind;
      v_entity_id := (v_item ->> 'entityId')::uuid;
      -- A missing key casts to NULL rather than raising, so absence has to be
      -- checked explicitly. Without this the NOT NULL violation escapes the
      -- per-item block and takes the whole batch down with it.
      if v_item_id is null or v_entity is null or v_entity_id is null then
        raise exception 'missing id, entity or entityId' using errcode = '22023';
      end if;
    exception when others then
      v_results := v_results || jsonb_build_object(
        'id', v_item ->> 'id',
        'status', 'rejected',
        'rejectionCode', 'malformed_item',
        'rejectionDetail', 'id, entity and entityId are required',
        'warnings', '[]'::jsonb);
      continue;
    end;

    select * into v_existing from public.sync_items s where s.id = v_item_id;

    -- Already settled. Report it and move on: a client that lost the response will
    -- resend, and resending must not double-apply or reopen a dead letter.
    if found and v_existing.status in ('accepted', 'duplicate') then
      v_results := v_results || jsonb_build_object(
        'id', v_item_id, 'status', 'duplicate',
        'rejectionCode', null, 'rejectionDetail', null,
        'warnings', to_jsonb(v_existing.warnings));
      continue;
    end if;

    if found and v_existing.status = 'dead_lettered' then
      v_results := v_results || jsonb_build_object(
        'id', v_item_id, 'status', 'dead_lettered',
        'rejectionCode', v_existing.rejection_code,
        'rejectionDetail', v_existing.rejection_detail,
        'warnings', to_jsonb(v_existing.warnings));
      continue;
    end if;

    v_attempts := coalesce(v_existing.attempt_count, 0) + 1;

    if v_attempts > c_max_attempts then
      v_status := 'dead_lettered';
      v_code   := coalesce(v_existing.rejection_code, 'internal_error');
      v_detail := format('gave up after %s attempts: %s', c_max_attempts,
                         coalesce(v_existing.rejection_detail, 'unknown'));
    else
      -- Per-item savepoint. A failure here rolls back this item only.
      begin
        v_warnings := public.apply_sync_item(v_entity, v_entity_id, v_item -> 'payload');
        v_status := 'accepted';
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
        v_status := 'rejected';
        v_detail := v_message;
        v_code := case
          when v_message ilike '%shift window%'      then 'outside_shift_window'
          when v_sqlstate = '42501'                  then 'not_your_record'
          when v_sqlstate = '0A000'                  then 'unsupported_entity'
          when v_sqlstate in ('23503', '23502')      then 'missing_reference'
          when v_sqlstate in ('23514', '23505', '22023', '22P02') then 'validation_failed'
          else 'internal_error'
        end::public.sync_rejection_code;
      end;
    end if;

    -- Written after the sub-block, so it survives the rollback of a failed item.
    insert into public.sync_items
      (id, batch_id, mr_id, entity, operation, entity_id, payload, status,
       rejection_code, rejection_detail, warnings, attempt_count, client_created_at, resolved_at)
    values
      (v_item_id, p_batch_id, v_uid, v_entity,
       coalesce(nullif(v_item ->> 'operation', ''), 'create'),
       v_entity_id, coalesce(v_item -> 'payload', '{}'::jsonb), v_status,
       v_code, v_detail, v_warnings, v_attempts,
       coalesce((v_item ->> 'clientCreatedAt')::timestamptz, now()),
       case when v_status in ('accepted', 'dead_lettered') then clock_timestamp() end)
    on conflict (id) do update
      set status           = excluded.status,
          batch_id         = excluded.batch_id,
          rejection_code   = excluded.rejection_code,
          rejection_detail = excluded.rejection_detail,
          warnings         = excluded.warnings,
          attempt_count    = excluded.attempt_count,
          resolved_at      = excluded.resolved_at;

    v_results := v_results || jsonb_build_object(
      'id', v_item_id,
      'status', v_status,
      'rejectionCode', v_code,
      'rejectionDetail', v_detail,
      'warnings', to_jsonb(v_warnings));
  end loop;

  return jsonb_build_object(
    'batchId', p_batch_id,
    'results', v_results,
    'serverTime', clock_timestamp());
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Observability — what support needs during the pilot
-- ----------------------------------------------------------------------------

-- Built now rather than when it is needed, because adding it later means querying
-- a table that already has months of real data in it and no index for the question.
create or replace function public.sync_queue_status(p_mr_id uuid default null)
returns table (
  mr_id                   uuid,
  accepted_count          integer,
  rejected_count          integer,
  dead_lettered_count     integer,
  last_successful_sync_at timestamptz,
  oldest_unresolved_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.mr_id,
         count(*) filter (where s.status in ('accepted', 'duplicate'))::integer,
         count(*) filter (where s.status = 'rejected')::integer,
         count(*) filter (where s.status = 'dead_lettered')::integer,
         max(s.received_at) filter (where s.status in ('accepted', 'duplicate')),
         min(s.client_created_at) filter (where s.status in ('rejected', 'dead_lettered'))
    from public.sync_items s
   where s.mr_id in (select public.visible_user_ids())
     and (p_mr_id is null or s.mr_id = p_mr_id)
   group by s.mr_id;
$$;

-- What was refused, and why, in a form the MR can be shown.
create or replace function public.list_sync_rejections(
  p_mr_id uuid default null,
  p_limit integer default 100
)
returns setof public.sync_items
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
    from public.sync_items s
   where s.mr_id in (select public.visible_user_ids())
     and (p_mr_id is null or s.mr_id = p_mr_id)
     and s.status in ('rejected', 'dead_lettered')
   order by s.client_created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- ----------------------------------------------------------------------------
-- 7. The shift window, exposed so the client can warn instead of ambush
-- ----------------------------------------------------------------------------

-- Frontend runs this rule client-side as advisory, so an MR is warned at capture
-- rather than told six hours later that three visits were refused. The client copy
-- is advisory only — this database is still the enforcement point — but the rule
-- has to be reachable for them to apply it at all.
create or replace function public.my_shift_window()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid;
  v_territory uuid;
  v_window    public.territory_shift_windows%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select p.territory_id into v_territory
    from public.user_profiles p
   where p.id = v_uid and p.is_active;

  if v_territory is null then
    return jsonb_build_object('window', null, 'resolvedFromTerritoryId', null);
  end if;

  v_window := public.effective_shift_window(v_territory);

  if v_window.id is null then
    -- Not an error. It is a state the app must render — "your working hours have
    -- not been configured, captures will be refused" — rather than retry.
    return jsonb_build_object('window', null, 'resolvedFromTerritoryId', null);
  end if;

  return jsonb_build_object(
    'window', to_jsonb(v_window),
    'resolvedFromTerritoryId', v_window.territory_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Boundary
-- ----------------------------------------------------------------------------

alter table public.sync_batches enable row level security;
alter table public.sync_batches force row level security;
alter table public.sync_items   enable row level security;
alter table public.sync_items   force row level security;

revoke all on table public.sync_batches from anon, authenticated;
revoke all on table public.sync_items   from anon, authenticated;

-- Read-only for the field. Everything is written by sync_push, which is the only
-- place attempt counting, dead-lettering and per-item isolation exist.
create policy sync_batches_select_scope
  on public.sync_batches for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

create policy sync_items_select_scope
  on public.sync_items for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

grant select on table public.sync_batches to authenticated;
grant select on table public.sync_items   to authenticated;

revoke execute on function public.apply_sync_item(public.sync_entity_kind, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.sync_push(uuid, jsonb)             to authenticated;
grant execute on function public.sync_queue_status(uuid)            to authenticated;
grant execute on function public.list_sync_rejections(uuid, integer) to authenticated;
grant execute on function public.my_shift_window()                  to authenticated;
