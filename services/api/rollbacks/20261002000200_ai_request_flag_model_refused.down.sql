-- Restores the flag list without `model_refused` -- ONLY while no request has recorded one.
--
-- W1-T B (`BE-C65`). The first version of this rollback rewrote such rows to `schema_invalid`. That
-- would have made the request log say something that did not happen -- and it could not even run:
-- `ai_requests_before_update` refuses ANY change to a completed request (23514, "ai request ... is
-- already failed"), so the rollback would have stopped on an error that explains nothing.
--
-- So: if a refusal has been recorded, the log is true and stays true, and this migration is fixed
-- FORWARD, not rolled back. The refusal names the count and the reason. With no such row -- every
-- database before a real model has answered -- it rolls back cleanly, as `verify-rollbacks` checks.

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.ai_requests where 'model_refused' = any (flags);
  if v_rows > 0 then
    raise exception
      'cannot roll back 20261002000200: % request(s) recorded a model refusal, and the request log '
      'is append-only -- rewriting them would make it say something that did not happen. Fix forward.',
      v_rows
      using errcode = '55000';
  end if;
end
$$;

alter table public.ai_requests drop constraint ai_requests_flags_known;
alter table public.ai_requests add constraint ai_requests_flags_known check (
  flags <@ array[
    'knowledge_not_available', 'schema_invalid', 'guardrail_triggered',
    'patient_identifier_detected', 'possible_adverse_event', 'possible_quality_complaint',
    'off_label_request', 'provider_timeout', 'provider_error'
  ]::text[]
);
