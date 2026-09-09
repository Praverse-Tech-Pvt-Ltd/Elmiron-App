-- Rollback for 20260908001500_sync_pull_clinic_addresses.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- **This reopens BE-W87.** After it runs `sync_pull` carries `visit`, `beat_plan` and
-- `doctor` again, and the doctor payload is the row and nothing else -- so no client can
-- build `Doctor.clinicAddresses`, and the four read paths that need it
-- (doctors/list.ts:50, doctors/profile.ts:62, today/plan.ts:64, today/route.ts:58) have
-- nothing to read.
--
-- It also drops the clinic tombstone trigger, so a deleted or reassigned clinic address
-- stops emitting `sync_events` and a client that already holds one keeps it for ever.
-- Rows written while the trigger is absent are NOT re-emitted when it is recreated.
--
-- `emit_sync_event` goes back to its three-table form.
--
-- **A correction to what this file used to say here.** It claimed the ELSE branch reads
-- `old.mr_id`, so recreating the clinic trigger against this version "raises rather than
-- misroutes -- loud, but a failure". That is true only of a table WITHOUT an `mr_id`.
-- Seventeen public tables have one, and for every one of them the ELSE reads
-- `case tg_table_name when 'visits' then 'visit' else 'beat_plan' end` and files the row
-- under `beat_plan` silently. MR-12 Part B demonstrated it on a scratch table and made
-- the arm raise; see 20260909000100_emit_sync_event_exhaustive.sql. Rolling this file
-- back reinstates the misroute.

drop trigger if exists clinic_addresses_sync_events on public.clinic_addresses;

-- The constraint narrows back, and the clinic_address tombstones go with it.
--
-- **This used to refuse.** The delete was written `... and false` -- a deliberate no-op --
-- so that narrowing the constraint would fail while any clinic_address tombstone existed,
-- the reasoning being that deleting them destroys the record of deletions clients may not
-- yet have pulled. The reasoning is sound. The placement was not.
--
-- `verify:rollbacks` runs LAST in CI, after the whole api suite, against the database that
-- suite just wrote to -- ci.yml says so and calls the ordering load-bearing. The suite
-- writes clinic_address tombstones. So the refusal was conditional on nothing: it fired on
-- every run. CI run 34326888642 is it firing.
--
-- A rollback that cannot execute is precisely what this repository says it will not
-- accept: "A rollback file that has never been executed is a claim, not a rollback." And
-- the record it was protecting does not survive the rollback in any usable form -- once
-- `sync_events_entity_check` no longer admits 'clinic_address', no client can read such a
-- tombstone and no `sync_pull` can serve it. Keeping the row does not preserve the
-- deletion; it only prevents the rollback.
--
-- So it deletes, and it says how many, for whoever is watching a real one.
do $$
declare
  v_count bigint;
begin
  delete from public.sync_events where entity = 'clinic_address';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    raise notice
      'rollback destroyed % clinic_address tombstone(s). Any client that had not pulled '
      'them keeps those addresses until its next full re-sync.', v_count;
  end if;
end $$;
alter table public.sync_events drop constraint if exists sync_events_entity_check;
alter table public.sync_events
  add constraint sync_events_entity_check
  check (entity = any (array['visit', 'beat_plan', 'doctor']));

create or replace function public.emit_sync_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'doctors' then
      insert into public.sync_events (entity, entity_id, reason, former_territory_id)
      values ('doctor', old.id, 'deleted', old.territory_id);
    else
      insert into public.sync_events (entity, entity_id, reason, former_mr_id)
      values (case tg_table_name when 'visits' then 'visit' else 'beat_plan' end,
              old.id, 'deleted', old.mr_id);
    end if;
    return old;
  end if;

  if tg_table_name = 'doctors' then
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

-- sync_pull, back to three entities. `completeness.entities` shrinks with it, which is
-- the field reporting the truth in the other direction.
CREATE OR REPLACE FUNCTION public.sync_pull(p_cursor text DEFAULT NULL::text, p_entities text[] DEFAULT NULL::text[], p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_max_cursor_bytes constant integer := 8192;
  c_entities constant text[] := array['visit', 'beat_plan', 'doctor'];
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
