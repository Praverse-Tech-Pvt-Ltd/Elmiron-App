-- Rollback for W2-E C: the request log goes back to being closed by the rep (`authenticated`) --
-- which re-opens `BE-W146`. The body is the definition installed by 20260924000700_ai_control_plane,
-- unchanged since. No row changes.

drop function public.ai_gateway_complete_request(
  uuid, public.ai_request_status, text, text, integer, integer, uuid[], text[], text);

create function public.ai_complete_request(
  p_request_id            uuid,
  p_status                public.ai_request_status,
  p_model_provider        text,
  p_model_name            text,
  p_input_tokens          integer,
  p_output_tokens         integer,
  p_knowledge_version_ids uuid[] default '{}',
  p_flags                 text[] default '{}',
  p_error_code            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_row    public.ai_requests%rowtype;
  v_now    timestamptz := clock_timestamp();
  v_ids    uuid[] := coalesce(p_knowledge_version_ids, '{}');
begin
  select * into v_caller from public.lms_caller();

  select * into v_row from public.ai_requests r
   where r.id = p_request_id and r.user_id = v_caller.user_id
   for update;
  if v_row.id is null then
    raise exception 'ai request % is not yours', p_request_id using errcode = '42501';
  end if;
  if v_row.status <> 'started' then
    raise exception 'ai request % is already %', v_row.id, v_row.status using errcode = '22023';
  end if;
  if p_status is null or p_status = 'started' then
    raise exception 'a completion must be completed, failed or blocked' using errcode = '22023';
  end if;
  if (select count(*) from public.knowledge_document_versions k
       where k.id = any (v_ids)
         and k.organisation_id = v_caller.organisation_id
         and k.status in ('approved', 'retired'))
     <> cardinality(array(select distinct unnest(v_ids))) then
    raise exception 'every knowledge source must be an approved version of your organisation'
      using errcode = '22023';
  end if;

  update public.ai_requests
     set status = p_status,
         completed_at = v_now,
         latency_ms = floor(extract(epoch from v_now - v_row.started_at) * 1000)::integer,
         model_provider = nullif(btrim(p_model_provider), ''),
         model_name = nullif(btrim(p_model_name), ''),
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         knowledge_version_ids = array(select distinct unnest(v_ids) order by 1),
         flags = array(select distinct unnest(coalesce(p_flags, '{}')) order by 1),
         error_code = p_error_code
   where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'requestId', v_row.id,
    'status', v_row.status,
    'completedAt', v_row.completed_at,
    'latencyMs', v_row.latency_ms,
    'flags', to_jsonb(v_row.flags));
end;
$$;

revoke all on function public.ai_complete_request(
  uuid, public.ai_request_status, text, text, integer, integer, uuid[], text[], text)
  from public, anon, authenticated;
grant execute on function public.ai_complete_request(
  uuid, public.ai_request_status, text, text, integer, integer, uuid[], text[], text)
  to authenticated;
