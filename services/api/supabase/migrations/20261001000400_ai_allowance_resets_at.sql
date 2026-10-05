-- W1-Q E2 — the instant the AI allowance resets, from the database that defines the day.
--
-- The frontend's FE-CR-6 asked for it: "the app may show a reset time only if the server sent it".
-- Until now the only statement of the reset was this function's HINT ("midnight, India time"),
-- which the gateway dropped. Two additions, nothing else changed (generated from pg_get_functiondef
-- of the installed function, replacing exactly two fragments):
--
--   1. 'allowanceResetsAt' on every successful begin.
--   2. The 45012 refusal carries {requestsUsedToday, dailyLimit, resetsAt} as its DETAIL, so the
--      gateway can put the figures on the 429 — the one response where the rep most needs them.
--
-- The instant is v_day + 1 day: v_day is already "today in India" (the same expression the count
-- uses), and India has no daylight-saving shift, so a day is always 24 hours there. A second copy of
-- the day rule in the gateway or the app would be a second place to get it wrong.
--
-- create or replace keeps the existing grant (authenticated only).

CREATE OR REPLACE FUNCTION public.ai_begin_request(p_feature ai_feature)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller  record;
  v_enabled jsonb;
  v_limit   numeric;
  v_prompt  public.ai_prompt_versions%rowtype;
  v_used    integer;
  v_day     timestamptz;
  v_row     public.ai_requests%rowtype;
  v_warn_pct numeric;
  v_warning  boolean := false;
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
      using errcode = '45012', hint = 'The allowance resets at midnight, India time.',
            detail = jsonb_build_object(
              'requestsUsedToday', v_used,
              'dailyLimit', v_limit,
              'resetsAt', v_day + interval '1 day')::text;
  end if;

  -- W1-M D1 (`BE-C30`). This request is number v_used + 1. At or past the warning line it is flagged
  -- in the response, and the FIRST such request of the day writes the one log row -- `on conflict do
  -- nothing` makes every later one a no-op, so the row records when the line was reached, not the
  -- most recent request past it. A percentage outside (0, 100] warns nobody rather than refusing
  -- the request: a mis-set WARNING must never become an outage of the thing it warns about.
  v_warn_pct := public.threshold_number('ai_daily_warning_percent', null, null);
  if v_warn_pct is not null and v_warn_pct > 0 and v_warn_pct <= 100
     and (v_used + 1) >= ceil(v_limit * v_warn_pct / 100) then
    v_warning := true;
    insert into public.ai_allowance_warnings
      (organisation_id, user_id, day, requests_used, daily_limit, warning_percent)
    values
      (v_caller.organisation_id, v_caller.user_id,
       (clock_timestamp() at time zone 'Asia/Kolkata')::date, v_used + 1, v_limit, v_warn_pct)
    on conflict (user_id, day) do nothing;
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
    'dailyLimit', v_limit,
    'allowanceWarning', v_warning,
    'allowanceResetsAt', v_day + interval '1 day');
end;
$function$;
