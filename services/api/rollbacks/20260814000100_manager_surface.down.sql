-- Rollback for 20260814000100_manager_surface.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Note: dropping sync_item_reinstatements destroys the record of who reversed which
-- dead letter and why. That record is the entire control on the reversal — there is
-- no taxonomy behind it — so export before running this anywhere real.

drop function if exists public.overdue_call_reports(interval);
drop function if exists public.approve_call_reports_bulk(uuid[], boolean, text);
drop function if exists public.approvable_call_reports(integer);
drop function if exists public.team_exceptions(date, integer);
drop function if exists public.mr_activity_detail(uuid, date);
drop function if exists public.coverage(date, date);
drop function if exists public.team_activity(date);

drop type if exists public.team_exception_kind;

-- Back to the BE-W3 signature: rows, and a silent cap.
drop function if exists public.search_doctors(text, uuid, integer);
create or replace function public.search_doctors(
  p_query        text default null,
  p_territory_id uuid default null,
  p_limit        integer default 50
)
returns setof public.doctors
language sql
stable
set search_path = ''
as $$
  select d.*
    from public.doctors d
   where d.is_active
     and (p_territory_id is null or d.territory_id = p_territory_id)
     and (
       p_query is null
       or btrim(p_query) = ''
       or d.full_name ilike '%' || p_query || '%'
       or d.specialty ilike '%' || p_query || '%'
       or d.registration_number = p_query
     )
   order by d.full_name
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
grant execute on function public.search_doctors(text, uuid, integer) to authenticated;

-- list_sync_rejections goes back to returning sync_items, so the view it depends on
-- has to be dropped after it is redefined.
drop function if exists public.list_sync_rejections(uuid, integer);
drop view if exists public.sync_item_explained;
drop function if exists public.sync_rejection_explanation(public.sync_rejection_code);

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
grant execute on function public.list_sync_rejections(uuid, integer) to authenticated;

drop function if exists public.reinstate_sync_item(uuid, text);

drop policy if exists sync_item_reinstatements_select_scope on public.sync_item_reinstatements;
drop trigger if exists sync_item_reinstatements_reject_mutation   on public.sync_item_reinstatements;
drop trigger if exists sync_item_reinstatements_audit             on public.sync_item_reinstatements;
drop trigger if exists sync_item_reinstatements_stamp_received_at on public.sync_item_reinstatements;
drop table if exists public.sync_item_reinstatements;

alter table public.sync_items drop constraint if exists sync_items_forgiven_not_exceeding_attempts;
alter table public.sync_items drop column if exists attempts_forgiven;

-- sync_push reverts to the BE-W4 body, which counts attempts without forgiveness.
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
    v_status := null; v_code := null; v_detail := null; v_warnings := '{}';

    begin
      v_item_id   := (v_item ->> 'id')::uuid;
      v_entity    := (v_item ->> 'entity')::public.sync_entity_kind;
      v_entity_id := (v_item ->> 'entityId')::uuid;
      if v_item_id is null or v_entity is null or v_entity_id is null then
        raise exception 'missing id, entity or entityId' using errcode = '22023';
      end if;
    exception when others then
      v_results := v_results || jsonb_build_object(
        'id', v_item ->> 'id', 'status', 'rejected',
        'rejectionCode', 'malformed_item',
        'rejectionDetail', 'id, entity and entityId are required',
        'warnings', '[]'::jsonb);
      continue;
    end;

    select * into v_existing from public.sync_items s where s.id = v_item_id;

    if found and v_existing.status in ('accepted', 'duplicate') then
      v_results := v_results || jsonb_build_object(
        'id', v_item_id, 'status', 'duplicate', 'rejectionCode', null,
        'rejectionDetail', null, 'warnings', to_jsonb(v_existing.warnings));
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
      begin
        v_warnings := public.apply_sync_item(v_entity, v_entity_id, v_item -> 'payload');
        v_status := 'accepted';
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
        v_status := 'rejected';
        v_detail := v_message;
        v_code := case
          when v_message ilike '%shift window%' then 'outside_shift_window'
          when v_sqlstate = '42501'             then 'not_your_record'
          when v_sqlstate = '0A000'             then 'unsupported_entity'
          when v_sqlstate in ('23503', '23502') then 'missing_reference'
          when v_sqlstate in ('23514', '23505', '22023', '22P02') then 'validation_failed'
          else 'internal_error'
        end::public.sync_rejection_code;
      end;
    end if;

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
      set status = excluded.status, batch_id = excluded.batch_id,
          rejection_code = excluded.rejection_code,
          rejection_detail = excluded.rejection_detail,
          warnings = excluded.warnings, attempt_count = excluded.attempt_count,
          resolved_at = excluded.resolved_at;

    v_results := v_results || jsonb_build_object(
      'id', v_item_id, 'status', v_status, 'rejectionCode', v_code,
      'rejectionDetail', v_detail, 'warnings', to_jsonb(v_warnings));
  end loop;

  return jsonb_build_object('batchId', p_batch_id, 'results', v_results,
                            'serverTime', clock_timestamp());
end;
$$;
