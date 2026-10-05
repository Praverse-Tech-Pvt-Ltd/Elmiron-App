-- Rollback for W1-M Part D1 -- the 80% warning is removed; `ai_begin_request` returns to its AI-D0
-- body, copied verbatim from 20260924000700_ai_control_plane.sql.
--
-- **What rolling back MEANS.** `ai_begin_request` stops returning `allowanceWarning`, and
-- `ai_allowance_warnings` is DROPPED with every warning it recorded. **Roll back `packages/core`
-- with this**: `AiBeginRequestResponseSchema` requires the field, so a core that expects it against
-- this schema fails every AI request at the parse -- loudly, as a failure, which is the safe
-- direction.
--
-- **The two `app_thresholds` rows stay.** That table is append-only by design and a rollback does
-- not get an exception to it. `ai_daily_warning_percent` = 80 is then read by nothing. The
-- `ai_daily_requests_per_user` = 100 row keeps applying, and that is the operator's decision
-- (`BE-C30`), not something this migration invented -- to undo it, write a later row with JSON
-- `null`, which restores the refusal "an unlimited allowance is never the default".

drop table if exists public.ai_allowance_warnings;

create or replace function public.ai_begin_request(p_feature public.ai_feature)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  record;
  v_enabled jsonb;
  v_limit   numeric;
  v_prompt  public.ai_prompt_versions%rowtype;
  v_used    integer;
  v_day     timestamptz;
  v_row     public.ai_requests%rowtype;
begin
  select * into v_caller from public.lms_caller();

  if p_feature is null then
    raise exception 'a feature is required' using errcode = '22023';
  end if;

  v_enabled := public.threshold('ai_feature_enabled:' || p_feature::text);
  if v_enabled is null or jsonb_typeof(v_enabled) <> 'boolean' or not (v_enabled)::text::boolean then
    raise exception 'AI feature % is switched off', p_feature
      using errcode = '45011', hint = 'Nothing is wrong with the request; the feature is not on.';
  end if;

  select * into v_prompt from public.ai_prompt_versions v
   where v.organisation_id = v_caller.organisation_id
     and v.feature = p_feature
     and v.status = 'approved';
  if v_prompt.id is null then
    raise exception 'AI feature % has no approved prompt for this organisation', p_feature
      using errcode = '45011';
  end if;

  v_limit := public.threshold_number('ai_daily_requests_per_user', null, null);
  if v_limit is null then
    raise exception 'AI feature % has no daily limit configured', p_feature
      using errcode = '45011', hint = 'An unlimited allowance is never the default.';
  end if;

  -- One caller's begins are serialised, so two concurrent requests cannot both see the last
  -- free slot. Other callers are unaffected.
  perform pg_advisory_xact_lock(hashtextextended('ai_begin_request:' || v_caller.user_id::text, 0));

  -- "Today" is the server's day in India, like every other day in this schema.
  v_day := date_trunc('day', clock_timestamp() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  select count(*) into v_used from public.ai_requests r
   where r.user_id = v_caller.user_id and r.started_at >= v_day;
  if v_used >= v_limit then
    raise exception 'daily AI allowance of % requests is used up', v_limit
      using errcode = '45012', hint = 'The allowance resets at midnight, India time.';
  end if;

  insert into public.ai_requests (organisation_id, user_id, feature, prompt_version_id)
  values (v_caller.organisation_id, v_caller.user_id, p_feature, v_prompt.id)
  returning * into v_row;

  return jsonb_build_object(
    'requestId', v_row.id,
    'feature', v_row.feature,
    'startedAt', v_row.started_at,
    'promptVersionId', v_prompt.id,
    'promptVersionNumber', v_prompt.version_number,
    'systemPrompt', v_prompt.system_prompt,
    'outputSchemaName', v_prompt.output_schema_name,
    'modelConfig', v_prompt.model_config,
    'requestsUsedToday', v_used + 1,
    'dailyLimit', v_limit);
end;
$$;
