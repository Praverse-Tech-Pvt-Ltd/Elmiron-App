-- ============================================================================
-- MR-44 B3 -- `beat_plan_entry` travels in the pull.
-- ============================================================================
--
-- `BE-W89`. `sync_pull` emitted five entities and `beat_plan_entries` was not among them,
-- so `BeatPlanRecordSchema` is `BeatPlanSchema.omit({ entries: true })` while the table
-- genuinely holds rows, and `buildDayRoute` maps `plan.entries` to stops. The screen would
-- render an empty route, which is why MR-14 left it on the mock rather than ship an empty
-- result presented as fact.
--
-- ----------------------------------------------------------------------------
-- WHAT THE REGISTER MISSED, AND IT IS THE WHOLE RE-SIZE
-- ----------------------------------------------------------------------------
--
-- **`beat_plan_entries` HAD NO `updated_at`.** Its columns were `id`, `beat_plan_id`,
-- `doctor_id`, `clinic_address_id`, `planned_sequence`. `sync_pull`'s `candidates` CTE
-- orders by `updated_at, id` and pages on them, so this was never "add a union-all arm":
-- it needed a column on an existing table first, with the trigger that maintains it.
--
-- The RLS half was already right, and that is what makes the arm safe:
-- `beat_plan_entries_select_via_plan` scopes through the plan's `mr_id` and
-- `visible_user_ids()`, which MR-42 closed the escape in. `sync_pull` is SECURITY INVOKER
-- and its arms carry no predicate for exactly that reason.
--
-- ----------------------------------------------------------------------------
-- EVERY FUNCTION BELOW IS REGENERATED FROM THE CATALOGUE, AND THE FIRST ATTEMPT WAS NOT
-- ----------------------------------------------------------------------------
--
-- The first version of this migration took `emit_sync_event` and `sync_events_entity_check`
-- from `20260908000300`, the migration that CREATED them. Both had been replaced since:
--
--   * `20260908001500` widened the constraint to include `clinic_address`. Re-adding the
--     narrower list failed against live rows -- loudly, which is the only reason it was
--     caught at all.
--   * `20260909000100` replaced `emit_sync_event` with an exhaustive version driven by
--     `sync_entity_for_table`, which RAISES for an unmapped table rather than defaulting.
--     A `create or replace` built from the older body would have silently reverted that.
--
-- A migration file records what the schema WAS at one moment. The catalogue records what
-- it IS. For `create or replace`, only the second is safe.
--
-- ----------------------------------------------------------------------------
-- WHAT A CLIENT HOLDING A CURSOR WILL AND WILL NOT RECEIVE
-- ----------------------------------------------------------------------------
--
-- **A real limitation, stated rather than discovered later.** The cursor is a snapshot,
-- not a timestamp: a row is emitted when its `xmin` is NOT visible in the client's `since`
-- snapshot. `add column ... default now()` is a fast default here and does not rewrite the
-- table, so existing entry rows keep their original `xmin`. **An incremental puller does
-- not retroactively receive entries it never had** -- it gets them on its next full
-- re-sync.
--
-- That is what `completeness.entities` is for: it now lists `beat_plan_entry`, and a client
-- comparing it against what it holds can tell a new entity became available. Acting on that
-- signal is client work and is registered as `FE-W50` rather than assumed.
--
-- And the completeness field GROWS here rather than shrinking: `beat_plan_entry` was never
-- in `c_omitted`, so nothing leaves that list. Claiming a shrink that did not happen would
-- be the same defect in the other direction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The column the cursor needs, and the trigger that maintains it.
-- ----------------------------------------------------------------------------
--
-- Mirrors `beat_plans_set_updated_at` exactly: BEFORE UPDATE, `set_updated_at()`, the same
-- function eight other tables already use. Not a new mechanism.

alter table public.beat_plan_entries
  add column if not exists updated_at timestamptz not null default now();

comment on column public.beat_plan_entries.updated_at is
  'Maintained by beat_plan_entries_set_updated_at. sync_pull orders and pages on '
  '(updated_at, id), so this column is what lets the entity travel in the pull at all. '
  'Existing rows carry the migration time and their ORIGINAL xmin, so an incremental '
  'puller receives them on its next full re-sync rather than retroactively -- see MR-44.';

drop trigger if exists beat_plan_entries_set_updated_at on public.beat_plan_entries;
create trigger beat_plan_entries_set_updated_at
  before update on public.beat_plan_entries
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. The entity is declared in the one place that refuses an unmapped table.
-- ----------------------------------------------------------------------------
--
-- `sync_entity_for_table` exists so that adding `emit_sync_event` to a table without
-- declaring it raises on the first write instead of filing its rows under another entity.
-- Adding the mapping here rather than a branch elsewhere is what keeps that guarantee.

alter table public.sync_events
  drop constraint if exists sync_events_entity_check;

alter table public.sync_events
  add constraint sync_events_entity_check
  check (entity = any (array['visit', 'beat_plan', 'doctor', 'clinic_address',
                             'beat_plan_entry']));

-- ----------------------------------------------------------------------------
-- 3. The three functions, from the catalogue.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_entity_for_table(p_table text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  -- Every table that carries `emit_sync_event`, and nothing else. Adding the trigger to a
  -- fifth table without adding it here raises on the first write instead of silently
  -- filing that table's rows under `beat_plan`.
  case p_table
    when 'visits'           then return 'visit';
    when 'beat_plans'       then return 'beat_plan';
    when 'doctors'          then return 'doctor';
    when 'clinic_addresses' then return 'clinic_address';
    when 'beat_plan_entries' then return 'beat_plan_entry';
    else
      raise exception 'emit_sync_event has no sync entity for table %', p_table
        using errcode = '0A000',
              hint = 'Add the table to sync_entity_for_table and to sync_events_entity_check, '
                     'or do not put emit_sync_event on it. Defaulting would file its rows '
                     'under another entity.';
  end case;
end;
$function$;

CREATE OR REPLACE FUNCTION public.emit_sync_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_territory uuid;
  v_former_mr uuid;
begin
  if tg_op = 'DELETE' then
    -- MR-44 / BE-W89. An entry has no scope key of its own: it is scoped through its
    -- parent plan's `mr_id`. If the plan is already gone (a cascade deletes it first)
    -- the lookup is null, and a null scope makes the tombstone visible to nobody --
    -- the SAFE direction, and correct besides, because the client learns the PLAN was
    -- deleted and drops its children with it.
    if tg_table_name = 'beat_plan_entries' then
      select b.mr_id into v_former_mr
        from public.beat_plans b where b.id = old.beat_plan_id;
      insert into public.sync_events (entity, entity_id, reason, former_mr_id)
      values ('beat_plan_entry', old.id, 'deleted', v_former_mr);
    elsif tg_table_name = 'clinic_addresses' then
      select d.territory_id into v_territory
        from public.doctors d where d.id = old.doctor_id;
      insert into public.sync_events (entity, entity_id, reason, former_territory_id)
      values ('clinic_address', old.id, 'deleted', v_territory);
    elsif tg_table_name = 'doctors' then
      insert into public.sync_events (entity, entity_id, reason, former_territory_id)
      values ('doctor', old.id, 'deleted', old.territory_id);
    else
      insert into public.sync_events (entity, entity_id, reason, former_mr_id)
      values (public.sync_entity_for_table(tg_table_name),
              old.id, 'deleted', old.mr_id);
    end if;
    return old;
  end if;

  -- UPDATE. Only a change of the SCOPE key is an event; every other update is already
  -- carried by the ordinary row path, which the new owner sees as an upsert.
  if tg_table_name = 'beat_plan_entries' then
    -- Only a change of parent plan can move an entry out of somebody's scope. Every
    -- other update already travels as an ordinary upsert through `updated_at`.
    if new.beat_plan_id is distinct from old.beat_plan_id then
      select b.mr_id into v_former_mr
        from public.beat_plans b where b.id = old.beat_plan_id;
      insert into public.sync_events (entity, entity_id, reason, former_mr_id)
      values ('beat_plan_entry', old.id, 'out_of_scope', v_former_mr);
    end if;
  elsif tg_table_name = 'clinic_addresses' then
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
      values (public.sync_entity_for_table(tg_table_name),
              old.id, 'out_of_scope', old.mr_id);
    end if;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.sync_pull(p_cursor text DEFAULT NULL::text, p_entities text[] DEFAULT NULL::text[], p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_max_cursor_bytes constant integer := 8192;
  c_entities constant text[] := array['visit', 'beat_plan', 'beat_plan_entry', 'doctor',
                                      'clinic_address', 'consent_text_version'];
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
    -- MR-44 / BE-W89. Its OWN arm, carrying no predicate, exactly like the clinic_address
    -- arm: this function is SECURITY INVOKER, so `beat_plan_entries_select_via_plan` does
    -- the scoping, through the plan's `mr_id` and `visible_user_ids()`. An entry has no
    -- `mr_id` of its own, which is precisely why it must NOT grow a hand-written predicate
    -- here: that would be a second copy of a boundary that already has one home.
    select 'beat_plan_entry', e.id, e.updated_at, e.xmin, 'upserted', to_jsonb(e)
      from public.beat_plan_entries e
     where 'beat_plan_entry' = any(v_want)
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
    -- MR-26 B1. The consent NOTICE travels with the pull so a doctor can be asked with no
    -- signal.
    --
    -- `apps/field/src/consent/notices.ts` called `active_consent_text` live, so an MR in a
    -- basement clinic could not put the question at all -- the screen rendered "the app could
    -- not reach the server" and the visit ended without an answer either way.
    --
    -- **This does NOT reopen MR-12 Q4.** That decision kept `consent_record` out of the pull
    -- and it stands, for the reason it gave: ~3,000 audit rows a day per entity, for value
    -- that is reinstall-only. A consent TEXT VERSION carries neither cost -- there are two in
    -- this tenant, they are immutable except for `effective_until`, and they change when a
    -- company publishes a new notice. `consent_record` remains in `c_omitted` below.
    --
    -- **No predicate, deliberately, exactly like the two arms above.** This function is
    -- SECURITY INVOKER, so `consent_text_versions_select_own_tenant` (permissive) and
    -- `consent_text_versions_tenant_boundary` (RESTRICTIVE) scope this arm. Adding
    -- `organisation_id = ...` here would be a second, unguarded copy of a rule the database
    -- owns -- which is what BE-W79 exists to prevent.
    --
    -- `full_text` rides along inside `to_jsonb`. That is the point: the client cannot show a
    -- doctor a notice it does not hold, and FIX-02's rule is unchanged -- the client still
    -- captures against a version id the SERVER issued, and `capture_consent` still
    -- re-resolves at `captured_at` and refuses 45001 if the two disagree.
    select 'consent_text_version', t.id, t.updated_at, t.xmin, 'upserted',
           -- MR-27 B1. The SERVER's precedence rides with the row, so the client never
           -- re-derives the ordering. See the migration header for why this is a RANK and
           -- not an `is_active` flag.
           to_jsonb(t) || jsonb_build_object('precedence', p.precedence)
      from public.consent_text_versions t
      join public.consent_text_version_precedence p on p.id = t.id
     where 'consent_text_version' = any(v_want)
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

drop trigger if exists beat_plan_entries_sync_events on public.beat_plan_entries;
create trigger beat_plan_entries_sync_events
  after delete or update on public.beat_plan_entries
  for each row execute function public.emit_sync_event();
