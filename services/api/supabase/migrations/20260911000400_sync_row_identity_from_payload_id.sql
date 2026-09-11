-- MR-24 B -- A DOCTOR'S WITHDRAWAL OF CONSENT WAS SILENTLY DISCARDED.
--
-- Observed end to end on the emulator, 11 September 2026:
--
--   1. Doctor consented. `consent_records`: one row, outcome `consented`.
--   2. Same visit, consent screen reopened, doctor tapped "No, don't record".
--   3. `sync_items`: `consent_record | accepted`. The app showed success.
--   4. `consent_records`: STILL ONE ROW, STILL `consented`.
--
-- The doctor's refusal existed nowhere, and the MR was told it was recorded. On a DPDP
-- consent ledger the record IS the evidence, and the evidence said the opposite of what the
-- doctor said.
--
-- ONE FIELD, TWO MEANINGS.
--
-- `push-client.ts` sends, for all five writes:
--
--   p_items: [{ id: body.id, entity, entityId: body.visitId, payload: body }]
--
-- and says why: "`entityId` is the VISIT for every one of these five ... so everything
-- waiting on one visit groups together ON THE QUEUE SCREEN. `id` is the request's own id and
-- is never regenerated -- it is the idempotency key."
--
-- So the client means `entityId` as a DISPLAY GROUPING key. This function used it as each
-- record's PRIMARY KEY -- `record_check_in`, `record_check_out` and `capture_consent` all
-- take it as `p_id` -- and each of those opens with an idempotency guard of the shape
--
--   select * into v_existing from public.consent_records c where c.id = p_id;
--   if found then ... return v_existing; end if;
--
-- With `p_id` = the visit id, the SECOND consent for a visit finds the first and returns it.
-- Accepted, unchanged, silent. Meanwhile `body.id` -- the value the client's own comment
-- calls the idempotency key -- was used by `sync_items` for batch dedupe and never became
-- the row id.
--
-- MEASURED BLAST RADIUS. Every clinical row for visit fca2d102-... carried
-- `id = fca2d102-...`: the check-in, the check-out, the consent record, the samples row and
-- the call report. So, per visit, at most one of each -- while `is_withdrawal`,
-- `supersedes_consent_record_id`, `supersedes_call_report_id` and the samples screen's "Add
-- another item" button all exist for the opposite.
--
-- THE FIX. Row identity comes from `p_payload ->> 'id'`, which every one of these request
-- bodies already carries (`id: UuidSchema` is required by all five schemas in
-- `packages/core`) and which the client already treats as the idempotency key.
-- `p_entity_id` keeps the grouping meaning the client intends. Replay safety is unchanged:
-- `sync_items` still dedupes the batch item, and each `record_*` guard still dedupes on a
-- stable per-request id -- a genuine retry carries the same `body.id` and is still a no-op.
--
-- `visit`, `recording` and `voice_note` are deliberately untouched: their payloads carry no
-- separate id and `entityId` genuinely is their identity.
--
-- A missing id on the other five RAISES rather than falling back to `p_entity_id`. The
-- fallback is the defect.
--
-- ROWS ALREADY WRITTEN keep the ids they were given. They are demo and test data; nothing
-- is rewritten here, and a deployment with real rows would need that question answered
-- separately rather than assumed.

CREATE OR REPLACE FUNCTION public.apply_sync_item(p_entity sync_entity_kind, p_entity_id uuid, p_payload jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid;
  v_warnings text[] := '{}';
  v_beat_plan uuid;
  v_row_id    uuid;
begin
  v_uid := (select auth.uid());

  -- MR-24. The row's identity is the REQUEST's own id, carried in the payload.
  -- `p_entity_id` is the client's GROUPING key (the visit), not an identity.
  v_row_id := nullif(p_payload ->> 'id', '')::uuid;
  if v_row_id is null and p_entity not in ('visit', 'recording', 'voice_note') then
    -- Refused rather than defaulted. Falling back to `p_entity_id` here is precisely the
    -- defect this migration removes, and a silent fallback would reinstate it for any body
    -- that lost its id on the way.
    raise exception 'a % item carries no id of its own', p_entity using errcode = '22023';
  end if;

  case p_entity
    when 'visit' then
      v_beat_plan := nullif(p_payload ->> 'beatPlanId', '')::uuid;
      if v_beat_plan is not null and public.beat_plan_is_stale(v_beat_plan) then
        v_warnings := array_append(v_warnings, 'stale_beat_plan');
      end if;

      insert into public.visits (id, mr_id, doctor_id, beat_plan_id, clinic_address_id,
                                 status, scheduled_for, started_at, completed_at)
      values (p_entity_id,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              v_beat_plan,
              nullif(p_payload ->> 'clinicAddressId', '')::uuid,
              coalesce(nullif(p_payload ->> 'status', ''), 'planned')::public.visit_status,
              nullif(p_payload ->> 'scheduledFor', '')::timestamptz,
              nullif(p_payload ->> 'startedAt', '')::timestamptz,
              nullif(p_payload ->> 'completedAt', '')::timestamptz)
      on conflict (id) do nothing;

    when 'check_in' then
      perform public.record_check_in(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload -> 'coordinates' ->> 'latitude')::double precision,
        (p_payload -> 'coordinates' ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload -> 'coordinates' ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

    when 'check_out' then
      perform public.record_check_out(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload -> 'coordinates' ->> 'latitude')::double precision,
        (p_payload -> 'coordinates' ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload -> 'coordinates' ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source,
        -- MR-12 D2. A check-out queued offline carries its outcome with it. Without this
        -- the reason is dropped on the way through the outbox and every replayed check-out
        -- lands as `completed` -- the same class as the check-out replayed as a check-in,
        -- and invisible for the same reason: the row arrives, just saying the wrong thing.
        nullif(p_payload ->> 'notMetReason', ''));

    when 'call_report' then
      if nullif(p_payload ->> 'supersedesCallReportId', '') is not null then
        perform public.revise_call_report(
          v_row_id,
          (p_payload ->> 'supersedesCallReportId')::uuid,
          coalesce(p_payload ->> 'summary', ''),
          coalesce((select array_agg(value::text::uuid)
                      from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                   '{}'::uuid[]),
          nullif(p_payload ->> 'objectionsRaised', ''),
          nullif(p_payload ->> 'nextStep', ''),
          coalesce(nullif(p_payload ->> 'status', ''), 'submitted')::public.call_report_status);
      else
        insert into public.call_reports (id, visit_id, mr_id, summary, product_ids_discussed,
                                         objections_raised, next_step, status, draft_source)
        values (v_row_id,
                (p_payload ->> 'visitId')::uuid,
                v_uid,
                coalesce(p_payload ->> 'summary', ''),
                coalesce((select array_agg(value::text::uuid)
                            from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                         '{}'::uuid[]),
                nullif(p_payload ->> 'objectionsRaised', ''),
                nullif(p_payload ->> 'nextStep', ''),
                coalesce(nullif(p_payload ->> 'status', ''), 'draft')::public.call_report_status,
                coalesce(nullif(p_payload ->> 'draftSource', ''), 'manual')::public.call_report_draft_source)
        on conflict (id) do nothing;
      end if;

    when 'consent_record' then
      -- BE-W74. A CAPTURE goes through capture_consent, exactly as check_in goes through
      -- record_check_in. Before this, the offline path did a direct INSERT, so every bound
      -- FIX-02 and FIX-12 built was absent on the one path where they exist to matter --
      -- offline capture is the entire reason FIX-12 validates against captured_at rather
      -- than now(). See the migration header for the proof, both directions.
      --
      -- capture_consent derives doctor_id from the visit and displayed_language from the
      -- version that was actually active at captured_at, so the payload's own `doctorId`
      -- and `displayedLanguage` are deliberately not passed: a client cannot assert either.
      -- It is idempotent on p_id, which is what `on conflict (id) do nothing` was doing.
      if coalesce((p_payload ->> 'isWithdrawal')::boolean, false) then
        -- A WITHDRAWAL is a different act and capture_consent cannot express it: it takes
        -- no supersedes_consent_record_id and no is_withdrawal. The table's own
        -- constraints and the validate_consent_withdrawal trigger are what guard this
        -- shape, and they fire on a direct insert. Routed separately rather than forced
        -- through a function that would have to grow two parameters it has no other use
        -- for.
        insert into public.consent_records (id, visit_id, doctor_id, captured_by_mr_id,
                                            outcome, not_asked_reason,
                                            consent_text_version_id, displayed_language,
                                            supersedes_consent_record_id, is_withdrawal,
                                            captured_at)
        values (v_row_id,
                (p_payload ->> 'visitId')::uuid,
                (p_payload ->> 'doctorId')::uuid,
                v_uid,
                (p_payload ->> 'outcome')::public.consent_outcome,
                nullif(p_payload ->> 'notAskedReason', ''),
                (p_payload ->> 'consentTextVersionId')::uuid,
                p_payload ->> 'displayedLanguage',
                nullif(p_payload ->> 'supersedesConsentRecordId', '')::uuid,
                true,
                (p_payload ->> 'capturedAt')::timestamptz)
        on conflict (id) do nothing;
      else
        perform public.capture_consent(
          v_row_id,
          (p_payload ->> 'visitId')::uuid,
          (p_payload ->> 'outcome')::public.consent_outcome,
          p_payload ->> 'displayedLanguage',
          (p_payload ->> 'consentTextVersionId')::uuid,
          nullif(p_payload ->> 'notAskedReason', ''),
          (p_payload ->> 'capturedAt')::timestamptz);
      end if;

    when 'sample_and_input' then
      insert into public.samples_and_inputs (id, visit_id, mr_id, doctor_id, kind, item_name,
                                             quantity, declared_value_inr, occurred_at)
      values (v_row_id,
              (p_payload ->> 'visitId')::uuid,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              (p_payload ->> 'kind')::public.sample_or_input_kind,
              p_payload ->> 'itemName',
              (p_payload ->> 'quantity')::integer,
              coalesce((p_payload ->> 'declaredValueInr')::numeric, 0),
              (p_payload ->> 'occurredAt')::timestamptz)
      on conflict (id) do nothing;

    when 'recording', 'voice_note' then
      -- The bytes are already in storage; this is the finalisation. complete_upload
      -- re-checks consent one last time, so a withdrawal that arrived while the
      -- device was offline stops the row from ever being created.
      if nullif(p_payload ->> 'uploadGrantId', '') is null then
        raise exception 'a % item must carry its uploadGrantId', p_entity
          using errcode = '22023';
      end if;

      perform public.complete_upload(
        (p_payload ->> 'uploadGrantId')::uuid,
        p_entity_id,
        (p_payload ->> 'durationSeconds')::integer,
        (p_payload ->> 'sizeBytes')::bigint,
        coalesce((p_payload ->> 'recordedAt')::timestamptz, now()),
        nullif(p_payload ->> 'bitrateKbps', '')::integer);

    else
      raise exception 'entity % is not yet accepted by sync', p_entity
        using errcode = '0A000';
  end case;

  return v_warnings;
end;
$function$;
