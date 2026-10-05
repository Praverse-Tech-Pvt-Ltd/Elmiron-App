-- ============================================================================
-- AI-D0 -- the AI control plane, database half: features, approved prompts, the request log.
-- ============================================================================
--
-- The master prompt, §3: every AI request passes one controlled path that knows who asked, for
-- which feature, with which prompt version, from which knowledge versions, on which model, at
-- what cost in tokens and time, and with which safety flags. §36: every production prompt is
-- versioned and approved, and a session names the version it used. §42: usage is tracked and
-- limited. §52: "Do not log confidential payloads unnecessarily."
--
-- **This is the half that does not depend on D1.** Whether the gateway is an Edge Function or a
-- service (`docs/ai-platform/phase-a-recon.md` §4), it calls Postgres: `ai_begin_request` before
-- the model, `ai_complete_request` after. Nothing here calls a model, holds a key, or names a
-- vendor (D2): provider and model are text the gateway reports.
--
-- **What is deliberately NOT here.**
-- * **No prompt text from a user and no model output.** The request log holds identifiers,
--   counts, timings and flags. A test asserts the log has no column that could hold a
--   conversation. Chat history, if it is kept at all, is its own table with its own retention.
-- * **No `patient_education` feature.** X1: a patient-facing assistant belongs in the clinical
--   project, where patient data lives, not here.
-- * **No per-organisation limit or switch.** Those are BE-W106 (due 2026-10-31). Flags and the
--   daily limit live in `app_thresholds` as GLOBAL rows, which decides nothing about the model.
-- * **No cost column.** Cost is tokens x a price, and a price is a fact that changes; it is
--   computed at read time from the tokens stored here, never frozen into a row.
--
-- **Every feature starts OFF, and "not configured" is off.** A feature runs only when
--   (1) `app_thresholds` has `ai_feature_enabled:<feature>` = true, and
--   (2) the organisation has an APPROVED prompt version for it, and
--   (3) `ai_daily_requests_per_user` is set.
-- Any one missing refuses with `45011`. Some features in the list are also blocked outside this
-- file, and switching a flag does not unblock them: `transcript_analysis`, `pv_screening` and
-- `complaint_screening` need transcripts, which need the PV/DPDP signatory (C3); `ai_coach` and
-- `ai_doctor` scoring wait on X2/X4.
--
-- **Prompts follow the approved-knowledge lifecycle exactly** (`20260924000600`): draft, in
-- review, approved or rejected, retired; four eyes; an attestation; one approved version per
-- organisation per feature. A prompt decides what the system says about a medicine; it gets the
-- same control as the text it draws on.
--
-- **The limit is counted when a request STARTS.** `ai_complete_request` is callable by the user
-- the request belongs to (the gateway forwards their token -- measured in the D1 spike), so a
-- caller could misreport their own token counts. Counting at the start means that cannot buy
-- more requests. Whether the gateway should instead hold its own credential for completion is
-- part of D1 and is recorded there, not decided here.

-- ----------------------------------------------------------------------------
-- 1. Types and tables
-- ----------------------------------------------------------------------------

create type public.ai_feature as enum (
  'mr_chat',
  'product_qa',
  'scientific_qa',
  'lms_tutor',
  'ai_doctor',
  'ai_coach',
  'assessment_grader',
  'transcript_analysis',
  'pv_screening',
  'complaint_screening',
  'content_recommendation',
  'manager_insights'
);

create type public.ai_request_status as enum ('started', 'completed', 'failed', 'blocked');

create table public.ai_prompt_versions (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null default public.current_user_organisation_id()
                        references public.organisations (id) on delete restrict,
  feature               public.ai_feature not null,
  version_number        integer not null,
  status                public.knowledge_version_status not null default 'draft',
  system_prompt         text not null,
  -- The name of the Zod schema in `@fieldforce/core` the output is validated against, or null
  -- for free text. A name, not a schema: the schema lives in one place, the contract package.
  output_schema_name    text,
  -- Provider-neutral settings (temperature, max tokens …). D2 decides what goes in it.
  model_config          jsonb not null default '{}'::jsonb,
  created_by_user_id    uuid not null references public.user_profiles (id) on delete restrict,
  submitted_at          timestamptz,
  submitted_by_user_id  uuid references public.user_profiles (id) on delete restrict,
  decided_at            timestamptz,
  decided_by_user_id    uuid references public.user_profiles (id) on delete restrict,
  approval_attestation  text,
  rejection_reason      text,
  retired_at            timestamptz,
  retired_by_user_id    uuid references public.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ai_prompt_versions_number_once unique (organisation_id, feature, version_number),
  constraint ai_prompt_versions_prompt_present check (length(btrim(system_prompt)) > 0),
  constraint ai_prompt_versions_schema_name_shape
    check (output_schema_name is null or output_schema_name ~ '^[A-Z][A-Za-z0-9]*Schema$'),
  constraint ai_prompt_versions_config_is_object check (jsonb_typeof(model_config) = 'object'),
  constraint ai_prompt_versions_submitted_is_stamped
    check (status = 'draft' or (submitted_at is not null and submitted_by_user_id is not null)),
  constraint ai_prompt_versions_decision_is_stamped
    check (status in ('draft', 'in_review')
           or (decided_at is not null and decided_by_user_id is not null)),
  constraint ai_prompt_versions_approval_is_attested
    check (status not in ('approved', 'retired') or length(btrim(approval_attestation)) > 0),
  constraint ai_prompt_versions_rejection_has_reason
    check (status <> 'rejected' or length(btrim(rejection_reason)) > 0),
  constraint ai_prompt_versions_retired_is_stamped
    check (status <> 'retired' or (retired_at is not null and retired_by_user_id is not null)),
  constraint ai_prompt_versions_four_eyes
    check (decided_by_user_id is null
           or (decided_by_user_id <> created_by_user_id
               and decided_by_user_id <> submitted_by_user_id))
);

create index ai_prompt_versions_feature_idx
  on public.ai_prompt_versions (organisation_id, feature, status);

create table public.ai_requests (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  user_id                uuid not null references public.user_profiles (id) on delete restrict,
  feature                public.ai_feature not null,
  prompt_version_id      uuid not null references public.ai_prompt_versions (id) on delete restrict,
  status                 public.ai_request_status not null default 'started',
  started_at             timestamptz not null default clock_timestamp(),
  completed_at           timestamptz,
  -- Server-computed at completion from the two server timestamps; never reported.
  latency_ms             integer,
  model_provider         text,
  model_name             text,
  input_tokens           integer,
  output_tokens          integer,
  -- Which approved knowledge versions the answer was built from (§8: traceable to the version).
  knowledge_version_ids  uuid[] not null default '{}',
  flags                  text[] not null default '{}',
  error_code             text,
  constraint ai_requests_tokens_nonnegative
    check ((input_tokens is null or input_tokens >= 0) and (output_tokens is null or output_tokens >= 0)),
  constraint ai_requests_completion_is_stamped
    check ((status = 'started') = (completed_at is null)),
  -- A closed vocabulary. A flag is a signal for a human queue, never a judgement: there is no
  -- severity, confidence or score beside it (the rule `adverse_event_reports` already follows).
  constraint ai_requests_flags_known check (flags <@ array[
    'knowledge_not_available',
    'schema_invalid',
    'guardrail_triggered',
    'patient_identifier_detected',
    'possible_adverse_event',
    'possible_quality_complaint',
    'off_label_request',
    'provider_timeout',
    'provider_error'
  ]::text[]),
  constraint ai_requests_error_code_shape check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,63}$')
);

create index ai_requests_user_day_idx on public.ai_requests (user_id, started_at);
create index ai_requests_org_feature_idx on public.ai_requests (organisation_id, feature, started_at);

-- ----------------------------------------------------------------------------
-- 2. Prompt lifecycle triggers -- the same rules as knowledge versions
-- ----------------------------------------------------------------------------

create or replace function public.ai_prompt_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(max(v.version_number), 0) + 1 into new.version_number
    from public.ai_prompt_versions v
   where v.organisation_id = new.organisation_id and v.feature = new.feature;
  new.status := 'draft';
  new.created_by_user_id := coalesce((select auth.uid()), new.created_by_user_id);
  new.submitted_at := null;
  new.submitted_by_user_id := null;
  new.decided_at := null;
  new.decided_by_user_id := null;
  new.approval_attestation := null;
  new.rejection_reason := null;
  new.retired_at := null;
  new.retired_by_user_id := null;
  return new;
end;
$$;

create trigger ai_prompt_versions_before_insert
  before insert on public.ai_prompt_versions
  for each row execute function public.ai_prompt_versions_before_insert();

create or replace function public.ai_prompt_versions_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organisation_id is distinct from old.organisation_id
     or new.feature is distinct from old.feature
     or new.version_number is distinct from old.version_number
     or new.created_by_user_id is distinct from old.created_by_user_id then
    raise exception 'ai prompt version: identity columns cannot change' using errcode = '23514';
  end if;
  if old.status <> 'draft' and (
       new.system_prompt is distinct from old.system_prompt
       or new.output_schema_name is distinct from old.output_schema_name
       or new.model_config is distinct from old.model_config) then
    raise exception 'ai prompt version % is % and cannot change; write a new version',
      old.id, old.status using errcode = '23514';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status = 'in_review')
       or (old.status = 'in_review' and new.status in ('approved', 'rejected'))
       or (old.status = 'approved' and new.status = 'retired')) then
    raise exception 'ai prompt version % cannot go from % to %', old.id, old.status, new.status
      using errcode = '23514';
  end if;
  if old.status in ('approved', 'rejected', 'retired') and (
       new.submitted_at is distinct from old.submitted_at
       or new.submitted_by_user_id is distinct from old.submitted_by_user_id
       or new.decided_at is distinct from old.decided_at
       or new.decided_by_user_id is distinct from old.decided_by_user_id
       or new.approval_attestation is distinct from old.approval_attestation
       or new.rejection_reason is distinct from old.rejection_reason) then
    raise exception 'ai prompt version %: a decision cannot be rewritten', old.id
      using errcode = '23514';
  end if;
  if old.status = 'retired' then
    raise exception 'ai prompt version % is retired and cannot change', old.id using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger ai_prompt_versions_before_update
  before update on public.ai_prompt_versions
  for each row execute function public.ai_prompt_versions_before_update();

create trigger ai_prompt_versions_reject_delete
  before delete or truncate on public.ai_prompt_versions
  for each statement execute function public.reject_mutation();

create trigger ai_prompt_versions_set_updated_at before update on public.ai_prompt_versions
  for each row execute function public.set_updated_at();
create trigger ai_prompt_versions_audit after insert or update on public.ai_prompt_versions
  for each row execute function public.write_audit_row();

-- ----------------------------------------------------------------------------
-- 3. The request log: one transition, then frozen
-- ----------------------------------------------------------------------------

create or replace function public.ai_requests_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'started' then
    raise exception 'ai request % is already %', old.id, old.status using errcode = '23514';
  end if;
  if new.id is distinct from old.id
     or new.organisation_id is distinct from old.organisation_id
     or new.user_id is distinct from old.user_id
     or new.feature is distinct from old.feature
     or new.prompt_version_id is distinct from old.prompt_version_id
     or new.started_at is distinct from old.started_at then
    raise exception 'ai request %: who, what and when it started cannot change', old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger ai_requests_before_update
  before update on public.ai_requests
  for each row execute function public.ai_requests_before_update();

create trigger ai_requests_reject_delete
  before delete or truncate on public.ai_requests
  for each statement execute function public.reject_mutation();

-- Audited on start and on completion: two rows per request. The log IS a record of AI use, but
-- `audit_log` is where "who did what" is proven, and it is append-only in a way this table is not
-- (one permitted transition).
create trigger ai_requests_audit after insert or update on public.ai_requests
  for each row execute function public.write_audit_row();

-- ----------------------------------------------------------------------------
-- 4. Prompt lifecycle RPCs
-- ----------------------------------------------------------------------------

create or replace function public.ai_admin_prompt_version(p_version_id uuid)
returns public.ai_prompt_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  record;
  v_version public.ai_prompt_versions%rowtype;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role <> 'admin' then
    raise exception 'only an admin manages AI prompts' using errcode = '42501';
  end if;
  select * into v_version from public.ai_prompt_versions v
   where v.id = p_version_id and v.organisation_id = v_caller.organisation_id
   for update;
  if v_version.id is null then
    raise exception 'prompt version % is not in your organisation', p_version_id using errcode = '42501';
  end if;
  return v_version;
end;
$$;

create or replace function public.submit_ai_prompt_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.ai_prompt_versions%rowtype;
  v_now     timestamptz := clock_timestamp();
begin
  v_version := public.ai_admin_prompt_version(p_version_id);
  if v_version.status <> 'draft' then
    raise exception 'prompt version % is already %', v_version.id, v_version.status using errcode = '22023';
  end if;
  update public.ai_prompt_versions
     set status = 'in_review', submitted_at = v_now, submitted_by_user_id = (select auth.uid())
   where id = v_version.id;
  return jsonb_build_object('promptVersionId', v_version.id, 'status', 'in_review', 'submittedAt', v_now);
end;
$$;

create or replace function public.approve_ai_prompt_version(p_version_id uuid, p_attestation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.ai_prompt_versions%rowtype;
  v_uid     uuid := (select auth.uid());
  v_now     timestamptz := clock_timestamp();
  v_retired uuid[];
begin
  v_version := public.ai_admin_prompt_version(p_version_id);
  if v_version.status <> 'in_review' then
    raise exception 'prompt version % is %, not in review', v_version.id, v_version.status
      using errcode = '22023';
  end if;
  if v_uid = v_version.created_by_user_id or v_uid = v_version.submitted_by_user_id then
    raise exception 'the author or submitter of prompt version % cannot approve it', v_version.id
      using errcode = '42501', hint = 'Four eyes: a second admin reviews and approves.';
  end if;
  if coalesce(btrim(p_attestation), '') = '' then
    raise exception 'approval needs a written attestation' using errcode = '22023';
  end if;

  with superseded as (
    update public.ai_prompt_versions v
       set status = 'retired', retired_at = v_now, retired_by_user_id = v_uid
     where v.organisation_id = v_version.organisation_id
       and v.feature = v_version.feature
       and v.status = 'approved'
    returning v.id
  )
  select coalesce(array_agg(id), '{}') into v_retired from superseded;

  update public.ai_prompt_versions
     set status = 'approved', decided_at = v_now, decided_by_user_id = v_uid,
         approval_attestation = btrim(p_attestation)
   where id = v_version.id;

  return jsonb_build_object(
    'promptVersionId', v_version.id, 'status', 'approved', 'decidedAt', v_now,
    'retiredPromptVersionIds', to_jsonb(v_retired));
end;
$$;

create or replace function public.reject_ai_prompt_version(p_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.ai_prompt_versions%rowtype;
  v_uid     uuid := (select auth.uid());
  v_now     timestamptz := clock_timestamp();
begin
  v_version := public.ai_admin_prompt_version(p_version_id);
  if v_version.status <> 'in_review' then
    raise exception 'prompt version % is %, not in review', v_version.id, v_version.status
      using errcode = '22023';
  end if;
  if v_uid = v_version.created_by_user_id or v_uid = v_version.submitted_by_user_id then
    raise exception 'the author or submitter of prompt version % cannot decide on it', v_version.id
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a rejection needs a reason' using errcode = '22023';
  end if;
  update public.ai_prompt_versions
     set status = 'rejected', decided_at = v_now, decided_by_user_id = v_uid,
         rejection_reason = btrim(p_reason)
   where id = v_version.id;
  return jsonb_build_object('promptVersionId', v_version.id, 'status', 'rejected', 'decidedAt', v_now);
end;
$$;

create or replace function public.retire_ai_prompt_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.ai_prompt_versions%rowtype;
  v_now     timestamptz := clock_timestamp();
begin
  v_version := public.ai_admin_prompt_version(p_version_id);
  if v_version.status <> 'approved' then
    raise exception 'prompt version % is %, not approved', v_version.id, v_version.status
      using errcode = '22023';
  end if;
  -- Retiring the only approved prompt switches the feature off for the organisation. That only
  -- makes the system say less, so it needs no second pair of eyes.
  update public.ai_prompt_versions
     set status = 'retired', retired_at = v_now, retired_by_user_id = (select auth.uid())
   where id = v_version.id;
  return jsonb_build_object('promptVersionId', v_version.id, 'status', 'retired', 'retiredAt', v_now);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. The request path
-- ----------------------------------------------------------------------------

/**
 * Called by the gateway, as the user, BEFORE any model call. Refuses, or opens a request and
 * hands back the approved prompt to use.
 *
 * Refusals a client can act on get their own SQLSTATEs (`refusals.ts`):
 *   45011 ai_feature_disabled -- switched off, or not configured for this organisation
 *   45012 ai_rate_limited     -- the caller's daily allowance is used up
 */
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

/**
 * Called by the gateway, as the same user, AFTER the model call. Once per request.
 *
 * The knowledge versions an answer names must be versions of this organisation that were
 * approved -- still approved, or since retired. A draft or a rejected version can never be
 * recorded as a source, so the log cannot claim approval for text that never had it.
 */
create or replace function public.ai_complete_request(
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

-- ----------------------------------------------------------------------------
-- 6. Privileges -- revoke before grant
-- ----------------------------------------------------------------------------

revoke all on table public.ai_prompt_versions, public.ai_requests
  from public, anon, authenticated, service_role;
revoke all on type public.ai_feature, public.ai_request_status from public, anon;
grant usage on type public.ai_feature, public.ai_request_status to authenticated;

grant select, insert on table public.ai_prompt_versions to authenticated;
grant update (system_prompt, output_schema_name, model_config)
  on table public.ai_prompt_versions to authenticated;
-- The log is read directly and written only through the two request RPCs.
grant select on table public.ai_requests to authenticated;

revoke all on function
  public.ai_prompt_versions_before_insert(),
  public.ai_prompt_versions_before_update(),
  public.ai_requests_before_update(),
  public.ai_admin_prompt_version(uuid),
  public.submit_ai_prompt_version(uuid),
  public.approve_ai_prompt_version(uuid, text),
  public.reject_ai_prompt_version(uuid, text),
  public.retire_ai_prompt_version(uuid),
  public.ai_begin_request(public.ai_feature),
  public.ai_complete_request(uuid, public.ai_request_status, text, text, integer, integer, uuid[], text[], text)
  from public, anon, authenticated;

grant execute on function
  public.submit_ai_prompt_version(uuid),
  public.approve_ai_prompt_version(uuid, text),
  public.reject_ai_prompt_version(uuid, text),
  public.retire_ai_prompt_version(uuid),
  public.ai_begin_request(public.ai_feature),
  public.ai_complete_request(uuid, public.ai_request_status, text, text, integer, integer, uuid[], text[], text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Row-level security
-- ----------------------------------------------------------------------------

alter table public.ai_prompt_versions enable row level security;
alter table public.ai_prompt_versions force row level security;
alter table public.ai_requests enable row level security;
alter table public.ai_requests force row level security;

-- Prompts are configuration: admins only. An MR has no reason to read the system prompt, and
-- reading it is the first step in writing a prompt that argues with it.
create policy ai_prompt_versions_admin_select on public.ai_prompt_versions
  for select to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id());
create policy ai_prompt_versions_admin_insert on public.ai_prompt_versions
  for insert to authenticated
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());
create policy ai_prompt_versions_admin_update on public.ai_prompt_versions
  for update to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

-- The log: your own requests, and an admin for the organisation's cost and safety review.
-- **Deliberately not a field manager.** Which features an MR used and when is monitoring of
-- the MR (C8), and giving a manager that view is a decision for a person, not a policy default.
create policy ai_requests_select_own_or_admin on public.ai_requests
  for select to authenticated
  using (user_id = (select auth.uid())
         or (public.is_admin() and organisation_id = public.current_user_organisation_id()));

create policy ai_prompt_versions_tenant_boundary on public.ai_prompt_versions
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy ai_requests_tenant_boundary on public.ai_requests
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

-- ----------------------------------------------------------------------------
-- 8. Self-checks
-- ----------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['ai_prompt_versions', 'ai_requests'] loop
    if not (select c.relforcerowsecurity from pg_class c
             where c.oid = format('public.%I', v_table)::regclass) then
      raise exception 'AI-D0: RLS is not forced on %', v_table;
    end if;
    if has_table_privilege('anon', format('public.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'truncate')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'delete') then
      raise exception 'AI-D0: % is reachable by anon, truncatable or deletable', v_table;
    end if;
    if not exists (select 1 from pg_policy p
                    where p.polrelid = format('public.%I', v_table)::regclass
                      and not p.polpermissive and p.polname = v_table || '_tenant_boundary') then
      raise exception 'AI-D0: % has no restrictive tenant boundary', v_table;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.ai_requests', 'insert')
     or has_table_privilege('authenticated', 'public.ai_requests', 'update')
     or has_column_privilege('authenticated', 'public.ai_prompt_versions', 'status', 'update') then
    raise exception 'AI-D0: the log and the prompt lifecycle must move only through the RPCs';
  end if;

  -- Every feature starts off: no flag row may exist yet that turns one on.
  if exists (select 1 from public.app_thresholds t
              where t.key like 'ai_feature_enabled:%' and t.value = 'true'::jsonb) then
    raise exception 'AI-D0: an AI feature is already switched on';
  end if;

  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
              where t.typname = 'ai_feature' and e.enumlabel like '%patient%') then
    raise exception 'AI-D0: patient-facing AI does not belong in this database (X1)';
  end if;
end;
$$;
