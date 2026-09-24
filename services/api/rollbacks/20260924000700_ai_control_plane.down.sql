-- Rollback for AI-D0 -- removes the AI control plane.
--
-- What rolling back MEANS: every prompt version (with its reviewer and attestation) and the whole
-- AI request log are destroyed -- the record of which approved prompt and which knowledge
-- versions every AI answer was built from. audit_log rows are NOT removed (append-only). Any
-- gateway calling `ai_begin_request` must be switched off first, or it will fail every call.
-- Flag rows in `app_thresholds` (`ai_feature_enabled:*`, `ai_daily_requests_per_user`) are left
-- alone: that table is append-only, and without these functions nothing reads them.
--
-- Order: functions that RETURN a table's row type depend on it, so they go before the tables
-- (the lesson of `20260924000600`'s rollback).

drop function if exists public.ai_complete_request(uuid, public.ai_request_status, text, text, integer, integer, uuid[], text[], text);
drop function if exists public.ai_begin_request(public.ai_feature);
drop function if exists public.retire_ai_prompt_version(uuid);
drop function if exists public.reject_ai_prompt_version(uuid, text);
drop function if exists public.approve_ai_prompt_version(uuid, text);
drop function if exists public.submit_ai_prompt_version(uuid);
drop function if exists public.ai_admin_prompt_version(uuid);

drop table if exists public.ai_requests;
drop table if exists public.ai_prompt_versions;

drop function if exists public.ai_requests_before_update();
drop function if exists public.ai_prompt_versions_before_update();
drop function if exists public.ai_prompt_versions_before_insert();

drop type if exists public.ai_request_status;
drop type if exists public.ai_feature;
