-- W1-S B (`BE-C64`) — a model REFUSAL is its own flag, not malformed output.
--
-- Until now a refusal (the vendor reporting that the model declined) reached the request log as
-- `schema_invalid`, exactly like a reply that was garbage: the KEY-DAY-CHECKLIST's predicted failure
-- #4, and one that makes the first real failure hard to read. `packages/core`'s `invalidOutput` now
-- flags it `model_refused`; this lets the database accept that flag.
--
-- Nothing else changes: every existing flag keeps its meaning, and no reader of `ai_requests` exists
-- outside its two writers (measured from the catalogue, W1-S B2), so no count is silently redefined.

alter table public.ai_requests drop constraint ai_requests_flags_known;
alter table public.ai_requests add constraint ai_requests_flags_known check (
  flags <@ array[
    'knowledge_not_available', 'schema_invalid', 'guardrail_triggered',
    'patient_identifier_detected', 'possible_adverse_event', 'possible_quality_complaint',
    'off_label_request', 'provider_timeout', 'provider_error',
    'model_refused'
  ]::text[]
);
