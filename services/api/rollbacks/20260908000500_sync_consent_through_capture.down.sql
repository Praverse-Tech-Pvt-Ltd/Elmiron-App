-- Rollback for 20260908000500_sync_consent_through_capture.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- **This restores an unvalidated consent path.** After applying it, a consent arriving
-- through `sync_push` is inserted directly again: no check that the displayed version was
-- active at `captured_at`, no refusal of a future `captured_at`, no maximum sync lag. The
-- offline path -- the only one where a capture and its receipt differ -- goes back to
-- accepting what the device says.
--
-- There is no good reason to apply this. It exists because every migration here has a
-- rollback and `verify:rollbacks` executes it, so that the file is a rollback rather than
-- a claim. If a capture is being refused and should not be, the fix is in
-- `capture_consent` or in `consent_max_sync_lag_hours` -- a threshold, changed by a new
-- append-only row, not by removing the check.

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
      insert into public.consent_records (id, visit_id, doctor_id, captured_by_mr_id, outcome,
                                          not_asked_reason, consent_text_version_id,
                                          displayed_language, supersedes_consent_record_id,
                                          is_withdrawal, captured_at)
      values (p_entity_id,
              (p_payload ->> 'visitId')::uuid,
              (p_payload ->> 'doctorId')::uuid,
              v_uid,
              (p_payload ->> 'outcome')::public.consent_outcome,
              nullif(p_payload ->> 'notAskedReason', ''),
              (p_payload ->> 'consentTextVersionId')::uuid,
              p_payload ->> 'displayedLanguage',
              nullif(p_payload ->> 'supersedesConsentRecordId', '')::uuid,
              coalesce((p_payload ->> 'isWithdrawal')::boolean, false),
              (p_payload ->> 'capturedAt')::timestamptz)
      on conflict (id) do nothing;

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


