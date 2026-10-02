-- Restores the flag list without `model_refused`. Rows written since carry that flag, and the old
-- constraint would refuse them; they are logged as what the old code logged a refusal as —
-- `schema_invalid` — before the constraint is restored. No row is deleted.

update public.ai_requests
   set flags = array_replace(flags, 'model_refused', 'schema_invalid')
 where 'model_refused' = any (flags);

alter table public.ai_requests drop constraint ai_requests_flags_known;
alter table public.ai_requests add constraint ai_requests_flags_known check (
  flags <@ array[
    'knowledge_not_available', 'schema_invalid', 'guardrail_triggered',
    'patient_identifier_detected', 'possible_adverse_event', 'possible_quality_complaint',
    'off_label_request', 'provider_timeout', 'provider_error'
  ]::text[]
);
