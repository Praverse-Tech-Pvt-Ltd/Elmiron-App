-- Rollback for 20260908000600_sync_verdict_sqlstate.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores the verdict without `sqlState`, so 45001, 45004, 45007 and 45008 collapse to
-- `internal_error` again and an MR is told "the server refused this" for four refusals
-- that each have a different remedy. It also restores the `ILIKE '%shift window%'`
-- fallback, which string-matches a message rather than reading a code.
--
-- A client that has been updated to prefer `sqlState` sees the key disappear rather than
-- change meaning, so it falls back to `rejectionCode` -- the behaviour it had before. That
-- is the one reassuring thing about applying this.

CREATE OR REPLACE FUNCTION public.sync_push(p_batch_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_max_attempts constant integer := 5;
  v_uid       uuid;
  v_item      jsonb;
  v_item_id   uuid;
  v_entity    public.sync_entity_kind;
  v_entity_id uuid;
  v_existing  public.sync_items%rowtype;
  v_attempts  integer;
  v_forgiven  integer;
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

    begin
      v_item_id   := (v_item ->> 'id')::uuid;
      v_entity    := (v_item ->> 'entity')::public.sync_entity_kind;
      v_entity_id := (v_item ->> 'entityId')::uuid;
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
    v_forgiven := coalesce(v_existing.attempts_forgiven, 0);

    if (v_attempts - v_forgiven) > c_max_attempts then
      v_status := 'dead_lettered';
      v_code   := coalesce(v_existing.rejection_code, 'internal_error');
      v_detail := format('gave up after %s attempts: %s', c_max_attempts,
                         coalesce(v_existing.rejection_detail, 'unknown'));
    else
      begin
        v_warnings := public.apply_sync_item(v_entity, v_entity_id, v_item -> 'payload');
        v_status := 'accepted';
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
        v_status := 'rejected';
        v_detail := v_message;
        -- The two upload branches are matched on the message rather than on a
        -- SQLSTATE, because both are ordinary 42501 and 22023 conditions that
        -- already mean something else here. Each has its own test, so a reworded
        -- message breaks a build rather than quietly degrading an MR's explanation
        -- back to 'the server refused the contents of this item'.
        v_code := case
          when v_message ilike '%consent has been withdrawn%' then 'consent_withdrawn'
          when v_message ilike '%upload grant%expired%'       then 'upload_expired'
          when v_message ilike '%shift window%'               then 'outside_shift_window'
          when v_sqlstate = '42501'                  then 'not_your_record'
          when v_sqlstate = '0A000'                  then 'unsupported_entity'
          when v_sqlstate in ('23503', '23502')      then 'missing_reference'
          when v_sqlstate in ('23514', '23505', '22023', '22P02') then 'validation_failed'
          else 'internal_error'
        end::public.sync_rejection_code;
      end;
    end if;

    insert into public.sync_items
      (id, batch_id, mr_id, entity, operation, entity_id, payload, status,
       rejection_code, rejection_detail, warnings, attempt_count, attempts_forgiven,
       client_created_at, resolved_at)
    values
      (v_item_id, p_batch_id, v_uid, v_entity,
       coalesce(nullif(v_item ->> 'operation', ''), 'create'),
       v_entity_id, coalesce(v_item -> 'payload', '{}'::jsonb), v_status,
       v_code, v_detail, v_warnings, v_attempts, v_forgiven,
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
$function$


