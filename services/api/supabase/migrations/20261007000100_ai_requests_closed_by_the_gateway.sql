-- W2-E C (`BE-W146`, `BE-C74`) -- the request log is closed by the gateway, never by the rep.
--
-- `ai_complete_request` ran as the rep: it checked only that the caller owned the row, then wrote
-- whatever status, model name and token counts it was given. A rep could close their own request as
-- `completed` by `claude-opus-99` with one token. The score is trustworthy (`BE-C69`); the record of
-- the call was not -- and model, token and status fields are what any cost or usage report would read.
--
-- The shape is the practice writers' (20261005000200): the write belongs to the gateway, which runs
-- as the service role, and is bound to the request ROW rather than to a caller -- it must exist and
-- still be `started`. The rep keeps `ai_begin_request` (which counts against their own allowance);
-- they lose the close entirely. The old function is DROPPED rather than revoked, so no grant on it
-- can survive and nothing can call it by mistake.
--
-- What this does NOT do: the service-role key can close any open request with any values. That is
-- the same capability moved from every rep's phone to one server secret (`BE-C72` governs the key),
-- which is the whole point. Who can BEGIN a request is unchanged.

drop function public.ai_complete_request(
  uuid, public.ai_request_status, text, text, integer, integer, uuid[], text[], text);

create function public.ai_gateway_complete_request(
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
  v_row public.ai_requests%rowtype;
  v_now timestamptz := clock_timestamp();
  v_ids uuid[] := coalesce(p_knowledge_version_ids, '{}');
begin
  -- Bound to the row: no caller identity is read. The gateway closes the id `ai_begin_request` gave
  -- it in the same invocation; an unknown id is the same refusal a stranger's id used to be.
  select * into v_row from public.ai_requests r where r.id = p_request_id for update;
  if v_row.id is null then
    raise exception 'ai request % does not exist', p_request_id using errcode = '42501';
  end if;
  if v_row.status <> 'started' then
    raise exception 'ai request % is already %', v_row.id, v_row.status using errcode = '22023';
  end if;
  if p_status is null or p_status = 'started' then
    raise exception 'a completion must be completed, failed or blocked' using errcode = '22023';
  end if;
  -- The organisation a source must belong to is the REQUEST's, not a caller's.
  if (select count(*) from public.knowledge_document_versions k
       where k.id = any (v_ids)
         and k.organisation_id = v_row.organisation_id
         and k.status in ('approved', 'retired'))
     <> cardinality(array(select distinct unnest(v_ids))) then
    raise exception 'every knowledge source must be an approved version of the request''s organisation'
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

revoke all on function public.ai_gateway_complete_request(
  uuid, public.ai_request_status, text, text, integer, integer, uuid[], text[], text)
  from public, anon, authenticated;
grant execute on function public.ai_gateway_complete_request(
  uuid, public.ai_request_status, text, text, integer, integer, uuid[], text[], text)
  to service_role;
