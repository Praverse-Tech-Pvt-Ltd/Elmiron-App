-- ============================================================================
-- BE-W74 - consent arriving through sync goes through capture_consent
--
-- `apply_sync_item` routes `check_in` through `record_check_in`, `check_out` through
-- `record_check_out` and `recording` through `complete_upload`, so geofence, shift window,
-- the server clock and the last consent check are all enforced however a write arrives.
-- **`consent_record` did a direct INSERT.**
--
-- So every bound FIX-02 and FIX-12 built was absent on the offline path -- the version
-- that was active AT `captured_at` (45001), no future capture (45007), the maximum sync
-- lag (45008) -- on the one path where they exist to matter. Offline capture is the whole
-- reason FIX-12 validates against `captured_at` rather than `now()`; the sync path is
-- where a capture and its receipt actually differ.
--
-- Measured before this migration, one fixture, both directions
-- (`sync-push-enforcement.spec.ts`):
--
--   capture_consent, notice superseded before the capture  ->  rejects, 45001
--   sync_push,       the identical capture                 ->  status "accepted",
--                    and consent_records stored the SUPERSEDED version as displayed
--   sync_push,       captured_at one day in the future     ->  status "accepted"
--
-- ----------------------------------------------------------------------------
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
-- ----------------------------------------------------------------------------
--
-- A CAPTURE now goes through `capture_consent`. Two things follow that are improvements
-- rather than side effects: `doctor_id` is derived from the visit rather than taken from
-- the payload, and `displayed_language` comes from the version that was actually active at
-- `captured_at`. **A client can no longer assert either.**
--
-- A WITHDRAWAL still does a direct insert. `capture_consent` cannot express one -- it
-- takes neither `supersedes_consent_record_id` nor `is_withdrawal` -- and the table's own
-- constraints plus `validate_consent_withdrawal` are what guard that shape, both of which
-- fire on a direct insert. Growing `capture_consent` two parameters it has no other use
-- for would make the common path carry the rare one.
--
-- Idempotency is preserved: `capture_consent` returns the existing row when `p_id` is
-- already present, which is what `on conflict (id) do nothing` was doing.
--
-- Rollback: services/api/rollbacks/20260908000500_sync_consent_through_capture.down.sql
-- ============================================================================

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
begin
  v_uid := (select auth.uid());

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
        p_entity_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload ->> 'latitude')::double precision,
        (p_payload ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

    when 'check_out' then
      perform public.record_check_out(
        p_entity_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload ->> 'latitude')::double precision,
        (p_payload ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

    when 'call_report' then
      if nullif(p_payload ->> 'supersedesCallReportId', '') is not null then
        perform public.revise_call_report(
          p_entity_id,
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
        values (p_entity_id,
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
        values (p_entity_id,
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
          p_entity_id,
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
      values (p_entity_id,
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
$function$


