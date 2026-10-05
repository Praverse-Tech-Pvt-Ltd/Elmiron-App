-- Restores the flag list without `output_truncated` -- ONLY while no request has recorded one.
--
-- The same rule as `20261002000200`'s rollback (`BE-C65`): the request log is never rewritten. If a
-- truncated answer has been recorded, the log is true and stays true, and this migration is fixed
-- FORWARD. With no such row it rolls back cleanly, as `verify-rollbacks` checks.

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.ai_requests where 'output_truncated' = any (flags);
  if v_rows > 0 then
    raise exception
      'cannot roll back 20261005000100: % request(s) recorded a truncated answer, and the request log '
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
    'off_label_request', 'provider_timeout', 'provider_error',
    'model_refused'
  ]::text[]
);
