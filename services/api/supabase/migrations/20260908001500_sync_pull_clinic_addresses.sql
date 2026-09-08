-- ============================================================================
-- MR-11 B - BE-W87: clinic addresses in the pull, as their own entity
--
-- `sync_pull` carried `visit`, `beat_plan` and `doctor`. The doctor payload is
-- `to_jsonb(d)` -- the row and nothing else -- so it has no clinic addresses, and four
-- read paths plus the geofence need them:
--
--     doctors/list.ts:50     doctor.clinicAddresses[0]?.city
--     doctors/profile.ts:62  doctor.clinicAddresses[0]
--     today/plan.ts:64       doctor.clinicAddresses.find(c => c.id === clinicAddressId)
--     today/route.ts:58-59   the same, for the route card
--     record_check_in        measures the geofence from the address on the visit
--
-- `pull.ts` states the difficulty in its own docstring -- *"rows, not aggregates"* -- and
-- does not resolve it, because nothing has ever called the module. FIX-14 C4 split
-- `DoctorRecord` off `Doctor` and called it "both right", which was the correct CONTRACT
-- fix and left nobody responsible for building the aggregate the screens read.
--
-- ----------------------------------------------------------------------------
-- B1. A SEPARATE ENTITY, NOT A DENORMALISED DOCTOR. THREE REASONS, CHECKED.
-- ----------------------------------------------------------------------------
--
-- 1. **The cursor is `(updated_at, id)` over an `xmin` snapshot.** A nested payload only
--    syncs a clinic edit if the DOCTOR's `updated_at` moves when a child row changes,
--    which means a trigger on `clinic_addresses` bumping its parent. That is
--    hand-maintained coupling, and this repo's own rule is that such a thing will
--    eventually be left off. If it ever were, a clinic edit would never sync and **nothing
--    would report it** -- the client would hold a stale address and believe it current.
--
-- 2. **`sync_pull` is SECURITY INVOKER, so RLS does the scoping.** That is why the doctor
--    arm reads `from public.doctors d` with no predicate at all. A separate arm inherits
--    `clinic_addresses_select_visible_doctor` for free. A nested payload could not: an
--    aggregate built inside the doctor arm is a subquery whose rows RLS does not filter
--    per-element in the way a reader would assume, so the scope would have to be
--    hand-written into the aggregate -- a transcription of a policy, which is exactly what
--    MR-06 deleted from `search_doctors` after it fell out of step.
--
-- 3. **Tombstones already work per entity.** `sync_events` is keyed `(entity, entity_id)`
--    and `entity` is `text`, so a clinic delete is an ordinary payload-free tombstone
--    through machinery that exists. Inside a nested payload a removed address is a
--    diff the client has to compute, and "the array got shorter" is not a deletion signal.
--
-- The cost is that a doctor can arrive before their addresses. That is a real cost and it
-- is handled honestly rather than hidden -- see B3/B4 below and the client change.
--
-- ----------------------------------------------------------------------------
-- B3. THE GEOFENCE, WHICH IS A PRODUCT ANSWER
-- ----------------------------------------------------------------------------
--
-- A doctor present with no clinic address yet cannot be geofenced. Three options were
-- available: refuse the check-in, fall back to manual, or wait.
--
-- **The answer is FALL BACK, RECORDED AS SUCH -- and the server already implements it.**
-- Verified in `record_check_in` rather than assumed:
--
--     if v_visit.clinic_address_id is not null then ... v_distance := distance_metres(...)
--     v_geofence := case when v_distance is null then 'unavailable' ... end;
--
-- With no address there is no distance, and the check-in is recorded with
-- `geofence_status = 'unavailable'`. Not refused, and **not invented**: `unavailable` is
-- one of exactly three values the enum permits, beside `inside` and `outside`.
--
-- So this migration changes nothing there, and that is the point of checking before
-- deciding: the behaviour was already the right one, and the decision is to keep it.
--
-- **Why it is right, rather than merely existing.** Refusing would mean an MR standing in
-- front of a doctor cannot record that they were there, because of a sync ordering
-- accident on their own phone. Waiting would mean a spinner with no bound, at a clinic
-- door, on a handset whose power manager may kill the sync entirely. A check-in with no
-- geofence is a smaller loss than a visit that was never recorded, and it is a loss the
-- data shows: `geofence_status` says so, so a manager can tell an unverified check-in from
-- a verified one. **The one thing not permitted is inventing a geofence result**, and
-- nothing here does.
--
-- Rollback: services/api/rollbacks/20260908001500_sync_pull_clinic_addresses.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tombstones for a clinic address.
-- ----------------------------------------------------------------------------
--
-- `emit_sync_event` dispatches on `tg_table_name` through an if/else chain whose ELSE
-- branch reads `old.mr_id`. `clinic_addresses` has `doctor_id` and no `mr_id`, so a
-- trigger added without a branch here would raise rather than misroute -- loudly, which is
-- better than the `sendFor` if-chain that silently sent a departure as an arrival, but it
-- is the same shape. The branch is explicit.
--
-- The scope key is the DOCTOR's territory, because that is what
-- `clinic_addresses_select_visible_doctor` scopes by. It is looked up rather than carried,
-- since `clinic_addresses` has no territory of its own.

-- `sync_events.entity` is `text` with a CHECK, not an enum -- so the type permitted a new
-- value and the constraint did not. Caught by the tombstone test rather than by reading
-- the column type, which is the whole reason the test writes a real deletion instead of
-- asserting the trigger exists.
alter table public.sync_events drop constraint if exists sync_events_entity_check;
alter table public.sync_events
  add constraint sync_events_entity_check
  check (entity = any (array['visit', 'beat_plan', 'doctor', 'clinic_address']));

create or replace function public.emit_sync_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_territory uuid;
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'clinic_addresses' then
      select d.territory_id into v_territory
        from public.doctors d where d.id = old.doctor_id;
      insert into public.sync_events (entity, entity_id, reason, former_territory_id)
      values ('clinic_address', old.id, 'deleted', v_territory);
    elsif tg_table_name = 'doctors' then
      insert into public.sync_events (entity, entity_id, reason, former_territory_id)
      values ('doctor', old.id, 'deleted', old.territory_id);
    else
      insert into public.sync_events (entity, entity_id, reason, former_mr_id)
      values (case tg_table_name when 'visits' then 'visit' else 'beat_plan' end,
              old.id, 'deleted', old.mr_id);
    end if;
    return old;
  end if;

  -- UPDATE. Only a change of the SCOPE key is an event; every other update is already
  -- carried by the ordinary row path, which the new owner sees as an upsert.
  if tg_table_name = 'clinic_addresses' then
    -- An address moving to another doctor leaves the scope of everyone who could see it
    -- through the old one.
    --
    -- A DOCTOR changing territory is deliberately NOT emitted here: the doctor's own
    -- trigger already emits `out_of_scope` for the doctor, and the client drops a doctor's
    -- addresses with the doctor. Emitting both would be two events for one fact, and the
    -- second would arrive for a record the client had already discarded.
    if new.doctor_id is distinct from old.doctor_id then
      select d.territory_id into v_territory
        from public.doctors d where d.id = old.doctor_id;
      insert into public.sync_events (entity, entity_id, reason, former_territory_id)
      values ('clinic_address', old.id, 'out_of_scope', v_territory);
    end if;
  elsif tg_table_name = 'doctors' then
    if new.territory_id is distinct from old.territory_id then
      insert into public.sync_events (entity, entity_id, reason, former_territory_id)
      values ('doctor', old.id, 'out_of_scope', old.territory_id);
    end if;
  else
    if new.mr_id is distinct from old.mr_id then
      insert into public.sync_events (entity, entity_id, reason, former_mr_id)
      values (case tg_table_name when 'visits' then 'visit' else 'beat_plan' end,
              old.id, 'out_of_scope', old.mr_id);
    end if;
  end if;
  return new;
end
$$;

create trigger clinic_addresses_sync_events
  after delete or update on public.clinic_addresses
  for each row execute function public.emit_sync_event();

-- ----------------------------------------------------------------------------
-- 2. The pull carries them.
-- ----------------------------------------------------------------------------
--
-- One more `union all` arm and one more entry in `c_entities`. Everything else -- the
-- `(updated_at, id)` total order across the union, the `pg_visible_in_snapshot` window,
-- the `limit v_lim + 1` truncation probe, the cursor encoding, the freeze-age refusal --
-- applies to the new arm unchanged, because it was written over the union rather than
-- per table.
--
-- `completeness.entities` grows with `c_entities`, which is the field doing its job: it
-- reports what this pull can carry, and it now carries one more thing.

-- ----------------------------------------------------------------------------
-- 2. The pull carries them.
-- ----------------------------------------------------------------------------
--
-- One more `union all` arm and one more entry in `c_entities`. Everything else -- the
-- `(updated_at, id)` total order across the union, the `pg_visible_in_snapshot` window,
-- the `limit v_lim + 1` truncation probe, the cursor encoding and the freeze-age refusal
-- -- applies to the new arm unchanged, because all of it was written over the union
-- rather than per table. `completeness.entities` grows with `c_entities`, which is that
-- field doing its job: it reports what this pull can carry, and it now carries one more.
--
-- **Taken from `pg_get_functiondef` and patched, not retyped.** The first attempt
-- rewrote the body by hand and dropped the `from page p` the aggregate selects over,
-- which failed on the first call with `missing FROM-clause entry for table "p"`. This
-- is a `create or replace` chain, and the repo's own rule for those is to read the LIVE
-- definition rather than trust a copy -- which applies to writing one as much as to
-- auditing one.

CREATE OR REPLACE FUNCTION public.sync_pull(p_cursor text DEFAULT NULL::text, p_entities text[] DEFAULT NULL::text[], p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_max_cursor_bytes constant integer := 8192;
  c_entities constant text[] := array['visit', 'beat_plan', 'doctor', 'clinic_address'];
  c_omitted  constant text[] := array['consent_record', 'analysis', 'call_report',
                                      'check_in', 'check_out', 'sample_and_input',
                                      'voice_note', 'recording'];
  v_uid          uuid;
  v_lim          integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_cursor       jsonb;
  v_since        pg_snapshot;
  v_upto         pg_snapshot;
  v_after_u      timestamptz;
  v_after_i      uuid;
  v_want         text[];
  v_rows         jsonb;
  v_has_more     boolean;
  v_last_u       timestamptz;
  v_last_i       uuid;
  v_freeze_limit bigint;
  v_since_age    bigint;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_cursor is null or btrim(p_cursor) = '' then
    v_cursor := null;
  else
    if octet_length(p_cursor) > c_max_cursor_bytes then
      raise exception 'sync cursor is not recognised' using errcode = '45005',
        detail = format('cursor is %s bytes, the maximum is %s',
                        octet_length(p_cursor), c_max_cursor_bytes),
        hint = 'Start again with a null cursor. This is a full re-sync, not an error you can retry.';
    end if;

    begin
      v_cursor := p_cursor::jsonb;
    exception when others then
      raise exception 'sync cursor is not recognised' using errcode = '45005',
        hint = 'Start again with a null cursor. This is a full re-sync, not an error you can retry.';
    end;
    if coalesce((v_cursor->>'v')::integer, 0) <> 1 then
      raise exception 'sync cursor is not recognised' using errcode = '45005',
        detail = format('cursor version %s, this server issues version 1', coalesce(v_cursor->>'v', 'absent')),
        hint = 'Start again with a null cursor. This is a full re-sync, not an error you can retry.';
    end if;
  end if;

  begin
    v_since   := nullif(v_cursor->>'since', '')::pg_snapshot;
    v_upto    := nullif(v_cursor->>'upto', '')::pg_snapshot;
    v_after_u := nullif(v_cursor#>>'{after,u}', '')::timestamptz;
    v_after_i := nullif(v_cursor#>>'{after,i}', '')::uuid;
  exception when others then
    raise exception 'sync cursor is not recognised' using errcode = '45005',
      hint = 'Start again with a null cursor. This is a full re-sync, not an error you can retry.';
  end;

  v_freeze_limit := (current_setting('vacuum_freeze_min_age')::bigint) / 2;

  if v_since is not null then
    v_since_age := age(pg_snapshot_xmin(v_since)::text::xid);
    if v_since_age >= v_freeze_limit then
      raise exception 'sync cursor is older than this server will vouch for'
        using errcode = '45006',
              detail = format(
                'cursor is %s transactions old; the limit is %s, half of vacuum_freeze_min_age',
                v_since_age, v_freeze_limit),
              hint = 'Pull again with a null cursor. Past this age a row frozen by VACUUM '
                     'could read as already-seen, and an incomplete answer that looks '
                     'complete is worse than starting over.';
    end if;
  end if;

  if v_upto is null then
    v_upto    := pg_current_snapshot();
    v_after_u := null;
    v_after_i := null;
  end if;

  v_want := coalesce(p_entities, c_entities);

  with candidates as (
    select 'visit'::text as entity, v.id, v.updated_at, v.xmin, 'upserted'::text as reason,
           to_jsonb(v) as payload
      from public.visits v
     where 'visit' = any(v_want)
    union all
    select 'beat_plan', b.id, b.updated_at, b.xmin, 'upserted', to_jsonb(b)
      from public.beat_plans b
     where 'beat_plan' = any(v_want)
    union all
    select 'doctor', d.id, d.updated_at, d.xmin, 'upserted', to_jsonb(d)
      from public.doctors d
     where 'doctor' = any(v_want)
    union all
    -- MR-11 / BE-W87. Its OWN arm, so RLS scopes it through
    -- `clinic_addresses_select_visible_doctor` exactly as the doctor arm is scoped -- this
    -- function is SECURITY INVOKER, which is why neither arm carries a predicate. And so a
    -- clinic edit moves its own `updated_at`, rather than depending on a trigger to bump a
    -- parent row that would otherwise never change.
    select 'clinic_address', a.id, a.updated_at, a.xmin, 'upserted', to_jsonb(a)
      from public.clinic_addresses a
     where 'clinic_address' = any(v_want)
    union all
    -- Tombstones and leave-scope, merged into the same ordering so a client cannot see a
    -- delete out of order with the update that preceded it.
    --
    -- `v_since is not null` is section 1's second protection: a full re-sync is a client
    -- rebuilding from nothing, so a tombstone could only tell it about records it never
    -- held. RLS on sync_events is the first protection and does the real work.
    --
    -- `age(...) < v_freeze_limit` keeps the guarantee between purge runs: an event older
    -- than the oldest acceptable cursor has already reached everyone entitled to it.
    select e.entity, e.entity_id, e.occurred_at, e.xmin, e.reason, null::jsonb
      from public.sync_events e
     where v_since is not null
       and e.entity = any(v_want)
       and age(e.xmin::text::xid) < v_freeze_limit
  ),
  changed as (
    select c.*
      from candidates c
     where pg_visible_in_snapshot(c.xmin::text::xid8, v_upto)
       and (v_since is null or not pg_visible_in_snapshot(c.xmin::text::xid8, v_since))
       and (v_after_u is null or (c.updated_at, c.id) > (v_after_u, v_after_i))
     order by c.updated_at, c.id
     limit v_lim + 1
  ),
  page as (
    select * from changed order by updated_at, id limit v_lim
  )
  select
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'entity',    p.entity,
                'entityId',  p.id,
                'reason',    p.reason,
                -- Null for a tombstone, and that is the payload-free property expressed
                -- in the wire format rather than only in the table.
                'payload',   p.payload,
                'updatedAt', p.updated_at
              ) order by p.updated_at, p.id)
         from page p),
      '[]'::jsonb),
    (select count(*) from changed) > v_lim
  into v_rows, v_has_more;

  if jsonb_array_length(v_rows) > 0 then
    v_last_u := (v_rows -> -1 ->> 'updatedAt')::timestamptz;
    v_last_i := (v_rows -> -1 ->> 'entityId')::uuid;
  end if;

  return jsonb_build_object(
    'changes', v_rows,
    'hasMore', v_has_more,
    'serverTime', now(),
    'nextCursor',
      case
        when v_has_more then
          jsonb_build_object('v', 1, 'since', v_since::text, 'upto', v_upto::text,
                             'after', jsonb_build_object('u', v_last_u, 'i', v_last_i))::text
        else
          jsonb_build_object('v', 1, 'since', v_upto::text, 'upto', null,
                             'after', null)::text
      end,
    'completeness', jsonb_build_object(
      'phase', 2,
      -- Phase 2 shrinks this, and `omits` empties. A completeness field that does not
      -- move as the capability grows becomes a lie in the other direction: a client that
      -- keeps warning about missing deletes after they arrive is as wrong as one that
      -- never warned.
      'reflects', case
        when v_since is null
          then jsonb_build_array('insert', 'update')
          else jsonb_build_array('insert', 'update', 'delete', 'out_of_scope')
        end,
      'omits', case
        when v_since is null
          then jsonb_build_array('delete', 'out_of_scope')
          else jsonb_build_array()
        end,
      'entities', to_jsonb(c_entities),
      'omittedEntities', to_jsonb(c_omitted),
      'maxCursorAgeTransactions', v_freeze_limit,
      'note', case
        when v_since is null
          then 'This is a full re-sync and carries no deletions: everything you are '
               'entitled to see is in the stream, so anything absent from it is gone. '
               'Replace your local state rather than merging into it.'
          else 'Deletions arrive as payload-free tombstones and records that left your '
               'scope arrive as out_of_scope. Consent records and analyses are not '
               'carried by this pull at all.'
        end
    )
  );
end;
$function$;

revoke execute on function public.sync_pull(text, text[], integer) from public;
grant execute on function public.sync_pull(text, text[], integer) to authenticated;
