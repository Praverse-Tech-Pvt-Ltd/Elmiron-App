-- W1-W C (`BE-C67`) — an answer cut off at a length limit is its own flag, not malformed output.
--
-- The Bedrock adapter passes the prompt version's `maxTokens` through. When the model reaches it, the
-- vendor reports stop reason `max_tokens` and the text is the first half of a JSON answer, which fails
-- to parse — so it reached the request log as `schema_invalid`, beside garbage output. That is the
-- confusion `BE-C64` removed for refusals (`20261002000200`), arriving by a second door, and it fires on
-- the longest output first: the coach. `packages/core`'s `invalidOutput` now flags it
-- `output_truncated`; this lets the database accept that flag.
--
-- Nothing else changes: every existing flag keeps its meaning.

alter table public.ai_requests drop constraint ai_requests_flags_known;
alter table public.ai_requests add constraint ai_requests_flags_known check (
  flags <@ array[
    'knowledge_not_available', 'schema_invalid', 'guardrail_triggered',
    'patient_identifier_detected', 'possible_adverse_event', 'possible_quality_complaint',
    'off_label_request', 'provider_timeout', 'provider_error',
    'model_refused', 'output_truncated'
  ]::text[]
);
