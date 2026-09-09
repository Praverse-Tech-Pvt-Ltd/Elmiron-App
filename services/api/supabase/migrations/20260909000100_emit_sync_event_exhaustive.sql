-- MR-12 Part B -- emit_sync_event was the fourth dispatch site, and it was unguarded.
--
-- MR-09 made `sendFor` exhaustive. MR-11 gave `applyChanges` a `never` default after
-- finding its bare `else` would have stored every clinic address as a beat plan. Both
-- audits were scoped to the site the defect had been found at. This is the same defect,
-- one layer down, and it was in the record as SAFE:
--
--   "emit_sync_event dispatches on tg_table_name through an if/else whose ELSE reads
--    old.mr_id. clinic_addresses has doctor_id, so a trigger added without a branch
--    would raise -- loud rather than silent."
--
-- That is true only for a table WITHOUT an mr_id. Seventeen public tables have one --
-- call_reports, check_ins, check_outs, samples_and_inputs, recordings, voice_notes and
-- eleven more -- and for every one of them both else arms read:
--
--   case tg_table_name when 'visits' then 'visit' else 'beat_plan' end
--
-- so the row inserts CLEANLY as a beat_plan carrying another table's id.
-- `sync_events_entity_check` permits 'beat_plan', so the constraint does not catch it.
--
-- Demonstrated before this migration, on a scratch table with an mr_id:
--
--   delete from public.scratch_call_thing where id = '1111...';
--   entity    | entity_id                            | reason
--   beat_plan | 11111111-1111-1111-1111-111111111111 | deleted
--
-- What that costs downstream: the client's applyChanges receives
-- {entity:'beat_plan', reason:'deleted', id:<a call report's id>} and calls
-- next.beat_plan.delete(id) on an id no beat plan has. The real deletion is never
-- applied, so the handset keeps a record the server destroyed -- and nothing anywhere
-- reports it, because every layer did exactly what it was told.
--
-- The fix removes the bare else entirely. One resolver owns table -> entity, and an
-- unknown table raises 0A000 -- the same code apply_sync_item already raises for an
-- unknown entity, which sync_push maps to `unsupported_entity`.

create or replace function public.sync_entity_for_table(p_table text)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
begin
  -- Every table that carries `emit_sync_event`, and nothing else. Adding the trigger to a
  -- fifth table without adding it here raises on the first write instead of silently
  -- filing that table's rows under `beat_plan`.
  case p_table
    when 'visits'           then return 'visit';
    when 'beat_plans'       then return 'beat_plan';
    when 'doctors'          then return 'doctor';
    when 'clinic_addresses' then return 'clinic_address';
    else
      raise exception 'emit_sync_event has no sync entity for table %', p_table
        using errcode = '0A000',
              hint = 'Add the table to sync_entity_for_table and to sync_events_entity_check, '
                     'or do not put emit_sync_event on it. Defaulting would file its rows '
                     'under another entity.';
  end case;
end;
$function$;

comment on function public.sync_entity_for_table(text) is
  'Resolves a table name to its sync_events.entity. Raises 0A000 rather than defaulting: '
  'MR-12 found both of emit_sync_event''s else arms filing unknown tables as beat_plan.';

CREATE OR REPLACE FUNCTION public.emit_sync_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      values (public.sync_entity_for_table(tg_table_name),
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
      values (public.sync_entity_for_table(tg_table_name),
              old.id, 'out_of_scope', old.mr_id);
    end if;
  end if;
  return new;
end
$function$;
