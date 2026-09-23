-- ============================================================================
-- MR-53 B1 -- the client ASKS whether this visit may be recorded. It does not decide.
-- ============================================================================
--
-- `app/visit/[id].tsx` holds `const consents: ConsentRecord[] = []` because `sync_pull` does not
-- carry `consent_record` -- a declared phase-2 omission (MR-21 B6), not an oversight. So the phone
-- cannot know whether the doctor agreed, and `recordingBlock([])` correctly draws no control. The
-- fix is NOT to put the ledger on the phone and re-derive the rule there: it is to ask the server
-- the one question the screen needs, and render its answer.
--
-- **The rule this returns is the rule the write already enforces.** `begin_upload` refuses a
-- recording unless a STANDING consent exists -- consented, not itself a withdrawal, and not
-- superseded by one -- and `assert_upload_still_permitted` re-checks the same thing before more
-- bytes are accepted. This read answers from the same predicate, and
-- `recording-permission.spec.ts` asserts the two AGREE in both directions rather than trusting that
-- they do: a read that says yes where the write says no is worse than no read at all.
--
-- **C3 IS NOT REVERSED BY THIS.** Recording still does not ship: `§8.6` requires a named PV/DPDP
-- signatory and `§2.4`'s adverse-event duty follows from transcripts existing. This function is
-- therefore gated on a feature flag that is OFF, inserted false below, and a build pointed at a
-- production URL refuses to enable its half at all (`packages/core`'s `loadAppConfig`, MR-53 B2).
-- Two switches, independent, both off.

/**
 * The consent record that authorises audio for this visit, or null.
 *
 * One expression, so the read below and the tests that compare it with `begin_upload` are talking
 * about the same rule. The three live writers keep their own copies for now -- rewriting
 * `begin_upload`, `assert_upload_still_permitted` and `require_consent_for_recording` in the same
 * change as introducing their first caller would put two risks in one migration -- and
 * `recording-permission.spec.ts` is what catches them drifting apart.
 */
CREATE OR REPLACE FUNCTION public.standing_consent_for_visit(p_visit_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id
    from public.consent_records c
   where c.visit_id = p_visit_id
     and c.outcome = 'consented'
     and c.is_withdrawal = false
     and not exists (select 1 from public.consent_records w
                      where w.supersedes_consent_record_id = c.id)
   order by c.captured_at desc
   limit 1;
$function$;

revoke all on function public.standing_consent_for_visit(uuid) from public, anon, authenticated;

/**
 * May this visit be recorded, and if not, why -- in terms the screen can render.
 *
 * Returns one of: `allowed`, `feature_off`, `not_your_visit`, `quarantined`, `never_asked`,
 * `declined`, `withdrawn`. The reasons are distinguished because the MR is owed different
 * sentences: "ask the doctor first" and "the doctor said no" are different facts, and MR-49 already
 * separated them on this screen.
 *
 * **Scoped to the caller's own visit.** Not `visible_user_ids()`: a manager has no business
 * starting a recording on someone else's visit, and `begin_upload` says the same with
 * `v.mr_id = v_uid`.
 */
CREATE OR REPLACE FUNCTION public.recording_permission(p_visit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid       uuid;
  v_visit     public.visits%rowtype;
  v_consent   uuid;
  v_agreed_at timestamptz;
  v_latest    public.consent_records%rowtype;
  v_enabled   boolean;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- The server half of the flag. Absent means false: a database that has never heard of this
  -- feature must not enable it, which is the state every deployment is in today.
  v_enabled := coalesce(
    (public.threshold('recording_feature_enabled') #>> '{}')::boolean, false);

  select * into v_visit from public.visits v where v.id = p_visit_id and v.mr_id = v_uid;
  if not found then
    -- Deliberately indistinguishable from "no such visit": whether another rep's visit exists is
    -- not this caller's business.
    return jsonb_build_object('allowed', false, 'reason', 'not_your_visit',
                              'featureEnabled', v_enabled, 'consentRecordId', null, 'consentCapturedAt', null);
  end if;

  if not v_enabled then
    return jsonb_build_object('allowed', false, 'reason', 'feature_off',
                              'featureEnabled', false, 'consentRecordId', null, 'consentCapturedAt', null);
  end if;

  if public.visit_is_quarantined(p_visit_id) then
    return jsonb_build_object('allowed', false, 'reason', 'quarantined',
                              'featureEnabled', true, 'consentRecordId', null, 'consentCapturedAt', null);
  end if;

  v_consent := public.standing_consent_for_visit(p_visit_id);
  if v_consent is not null then
    -- The screen shows "recording, with agreement given at HH:MM". That time is the consent's,
    -- not the device's clock, so it comes back with the permission rather than being guessed.
    select c.captured_at into v_agreed_at
      from public.consent_records c where c.id = v_consent;
    return jsonb_build_object('allowed', true, 'reason', 'allowed', 'featureEnabled', true,
                              'consentRecordId', v_consent, 'consentCapturedAt', v_agreed_at);
  end if;

  -- No standing consent. WHICH no is what the screen needs.
  select * into v_latest
    from public.consent_records c
   where c.visit_id = p_visit_id
   order by c.captured_at desc
   limit 1;

  return jsonb_build_object(
    'allowed', false,
    'reason', case
                when v_latest.id is null then 'never_asked'
                when v_latest.is_withdrawal then 'withdrawn'
                when exists (select 1 from public.consent_records w
                              where w.supersedes_consent_record_id = v_latest.id) then 'withdrawn'
                else 'declined'
              end,
    'featureEnabled', true,
    'consentRecordId', null,
    'consentCapturedAt', null);
end;
$function$;

revoke all on function public.recording_permission(uuid) from public, anon;
grant execute on function public.recording_permission(uuid) to authenticated;

-- The server half of the flag, OFF. `app_thresholds` is append-only, so turning it on in a
-- development database is a dated, attributable row -- and production has no such row at all.
insert into public.app_thresholds (key, value, scope, note)
values (
  'recording_feature_enabled',
  'false'::jsonb,
  'global',
  'MR-53 B2. Consultation recording is built but must not reach a real doctor: C3 stands until the '
  || 'named PV/DPDP signatory exists (scope 8.6) and the 2.4 adverse-event duty is owned. OFF. The '
  || 'client half refuses to enable against a production URL (packages/core loadAppConfig).'
);

do $$
begin
  if (public.threshold('recording_feature_enabled') #>> '{}')::boolean then
    raise exception 'MR-53 B2: the recording feature flag must ship OFF';
  end if;

  -- The read must exist and must refuse an unauthenticated caller rather than answering.
  if to_regprocedure('public.recording_permission(uuid)') is null then
    raise exception 'MR-53 B1: recording_permission was not created';
  end if;
  if has_function_privilege('anon', 'public.recording_permission(uuid)', 'execute') then
    raise exception 'MR-53 B1: recording_permission is callable by anon';
  end if;
  if has_function_privilege('authenticated', 'public.standing_consent_for_visit(uuid)', 'execute') then
    raise exception 'MR-53 B1: the consent predicate is callable directly by a signed-in user';
  end if;

  -- A precondition this guard asserts about itself: the flag row it just read is the one inserted
  -- above, not an older one that happened to be false.
  if not exists (select 1 from public.app_thresholds
                  where key = 'recording_feature_enabled' and note like 'MR-53 B2.%') then
    raise exception 'MR-53 B2: the flag row this migration inserted is not present';
  end if;
end;
$$;
