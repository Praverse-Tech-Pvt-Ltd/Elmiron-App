-- W1-M Part D1 -- the daily AI allowance gets its launch value and a WARNING AT 80%. `BE-C30`.
--
-- **What already existed, measured before writing this:** the allowance is a per-company threshold
-- (`ai_daily_requests_per_user`, resolved territory > organisation > global since
-- 20260930000300), so "admin-changeable without a code change" was already true; and every request
-- is a row in `ai_requests`, so "usage logged" was already true. **No row set a value**, so every
-- company was refused with 45011 until somebody ran SQL.
--
-- **What is new is the warning, and the question that decides its design is WHO IT REACHES.**
--
--   * **The company admin -- a ROW.** The first request that reaches the warning line writes one row
--     to `ai_allowance_warnings`, once per rep per India day. Readable by the rep themselves and by
--     an admin of the same company. **Not by a field manager:** `BE-C13` already ruled that a manager
--     does not see which AI features an MR used, and how heavily they used them is the same fact.
--   * **The gateway -- a FIELD.** `ai_begin_request` returns `allowanceWarning: true` on every request
--     at or past the line, so the flow holding the request knows.
--   * **The rep's screen -- NOT YET.** No flow passes the field on to its result, and no screen shows
--     it. That needs each of the five flows to carry it and the app to render it, which is frontend
--     work; registered as `BE-W128` rather than half-built here. **Until then the warning reaches the
--     admin and a log, and the rep finds out at 100 when they are refused.**
--
-- **Why a row rather than a column on `ai_requests`:** the warning is a fact about a rep's DAY, not
-- about one request, and "did this rep get warned on 1 October" should be one lookup, not a scan for
-- the first request that crossed a line whose value may since have changed.
--
-- The replacement body of `ai_begin_request` was generated from `pg_proc.prosrc` on the running
-- database. The ONLY change is the block marked W1-M D1 and the one new key in the returned object.

-- ----------------------------------------------------------------------------
-- 1. The two values the operator decided. GLOBAL rows, overridable per company.
-- ----------------------------------------------------------------------------
--
-- A global row is right here and was wrong for the feature flags (`BE-C29`): a feature flag switched
-- on globally would switch AI on for every future tenant nobody has asked, whereas a CEILING of 100
-- only ever refuses. The allowance stays a cap that fails closed -- and the old "an unlimited
-- allowance is never the default" refusal still fires for any company that sets it to JSON null.

insert into public.app_thresholds (key, value, unit, scope, note)
values
  ('ai_daily_requests_per_user', '100'::jsonb, 'requests', 'global',
   'BE-C30 (operator, 1 October 2026): 100 AI requests per MR per day as the launch default. '
   'Change per company with set_organisation_threshold; no code change.'),
  ('ai_daily_warning_percent', '80'::jsonb, 'percent', 'global',
   'BE-C30 (operator, 1 October 2026): warn at 80% of the daily allowance. '
   'Recorded once per rep per day in ai_allowance_warnings.');

-- ----------------------------------------------------------------------------
-- 2. The log. One row per rep per India day, at most.
-- ----------------------------------------------------------------------------

create table public.ai_allowance_warnings (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  user_id         uuid not null references public.user_profiles (id) on delete restrict,
  -- The India calendar day, the same day `ai_begin_request` counts against.
  day             date not null,
  -- The request number that reached the line, the allowance, and the percentage -- as they were AT
  -- THAT MOMENT. All three can change later; a log that recomputed them would rewrite history.
  requests_used   integer not null,
  daily_limit     numeric not null,
  warning_percent numeric not null,
  created_at      timestamptz not null default now(),
  constraint ai_allowance_warnings_once_a_day unique (user_id, day),
  constraint ai_allowance_warnings_used_positive check (requests_used > 0),
  constraint ai_allowance_warnings_percent_range check (warning_percent > 0 and warning_percent <= 100)
);

revoke all on table public.ai_allowance_warnings from anon, authenticated, service_role;
grant select on table public.ai_allowance_warnings to authenticated;

alter table public.ai_allowance_warnings enable row level security;
alter table public.ai_allowance_warnings force row level security;

-- The rep and their company admin. NOT `visible_user_ids()`: that is the manager read, and `BE-C13`
-- keeps AI usage off the manager surface.
create policy ai_allowance_warnings_read on public.ai_allowance_warnings for select to authenticated
  using (organisation_id = public.current_user_organisation_id()
         and (user_id = (select auth.uid()) or public.is_admin()));

create policy ai_allowance_warnings_tenant_boundary on public.ai_allowance_warnings
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

-- ----------------------------------------------------------------------------
-- 3. `ai_begin_request`, with the warning.
-- ----------------------------------------------------------------------------

create or replace function public.ai_begin_request(p_feature public.ai_feature)
returns jsonb
language plpgsql
volatile
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
      using errcode = '45012', hint = 'The allowance resets at midnight, India time.';
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
    'allowanceWarning', v_warning);
end;
$$;
