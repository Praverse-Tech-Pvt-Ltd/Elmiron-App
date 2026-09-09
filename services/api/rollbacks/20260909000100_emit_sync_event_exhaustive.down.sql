-- Rollback for MR-12 Part B.
--
-- Restores emit_sync_event to the definition captured with pg_get_functiondef immediately
-- before the change, and drops the resolver. This REINSTATES the bare else arms, so an
-- emit_sync_event trigger on any table with an mr_id again files its rows under
-- 'beat_plan' silently.

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
$function$;

drop function if exists public.sync_entity_for_table(text);
