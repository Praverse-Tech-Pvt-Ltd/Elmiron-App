-- Rollback for 20260908000700_consent_future_tolerance.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores the absolute forward bound: ANY captured_at after the server clock is refused
-- with 45007. That means an ordinary online capture from a handset whose clock is two
-- seconds fast is refused, and the MR is told to fix a clock they cannot see is wrong --
-- on exactly the devices whose power managers stop background time sync.
--
-- If the tolerance is the problem, change the THRESHOLD rather than applying this:
-- app_thresholds is append-only, so a new row with a smaller value is a dated,
-- attributable change, and zero reproduces this file's behaviour without removing the
-- mechanism.
--
-- The app_thresholds row is NOT deleted: that table is append-only and enforced by a
-- statement-level reject_mutation trigger, so a delete would be refused with 23001 and
-- this file would fail halfway. An unread threshold is inert.

CREATE OR REPLACE FUNCTION public.capture_consent(p_id uuid, p_visit_id uuid, p_outcome consent_outcome, p_language text, p_consent_text_version_id uuid, p_not_asked_reason text DEFAULT NULL::text, p_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS consent_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid         uuid;
  v_visit       public.visits%rowtype;
  v_displayed   public.consent_text_versions%rowtype;
  v_active_then public.consent_text_versions%rowtype;
  v_existing    public.consent_records%rowtype;
  v_row         public.consent_records%rowtype;
  v_captured_at timestamptz;
  v_max_lag     numeric;
  v_lag         interval;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_existing from public.consent_records c where c.id = p_id;
  if found then
    if v_existing.captured_by_mr_id <> v_uid then
      raise exception 'consent record % belongs to another user', p_id using errcode = '42501';
    end if;
    return v_existing;
  end if;

  select * into v_visit from public.visits v where v.id = p_visit_id and v.mr_id = v_uid;
  if not found then
    raise exception 'visit % is not yours', p_visit_id using errcode = '42501';
  end if;

  if p_consent_text_version_id is null then
    raise exception 'consent capture requires the consent text version that was displayed'
      using errcode = '22023';
  end if;

  v_captured_at := coalesce(p_captured_at, now());

  -- ---- bound 1: no future captures -----------------------------------------
  --
  -- `received_at` defaults to clock_timestamp(), which inside this transaction is at or
  -- after now(), so `captured_at <= now()` implies `captured_at <= received_at` and the
  -- stored `capture_lag` can never be negative.
  --
  -- 45007. The remedy is neither "sync" nor "ask again": the device clock is wrong, and
  -- telling an MR to re-ask a doctor because their phone thinks it is Thursday would be
  -- both useless and slightly insulting.
  if v_captured_at > now() then
    raise exception 'consent cannot be captured in the future'
      using errcode = '45007',
            detail = format('captured_at %s is after the server clock %s', v_captured_at, now()),
            hint   = 'The device clock is ahead of the server. Correct it and sync again; '
                     'do not re-ask the doctor.';
  end if;

  -- ---- bound 2: the maximum sync lag ---------------------------------------
  --
  -- 45008, distinct from 45001 because the remedy is different: this capture is fine and
  -- arrived too late to be accepted on the handset's word alone. The MR should sync more
  -- often, not go back to the doctor.
  v_lag := now() - v_captured_at;
  -- Territory-scoped like every other threshold, resolved through the MR's own profile
  -- because  carries no territory of its own.
  v_max_lag := public.threshold_number(
    'consent_max_sync_lag_hours',
    (select p.territory_id from public.user_profiles p where p.id = v_uid),
    null);
  if v_max_lag is not null and v_lag > make_interval(hours => v_max_lag::integer) then
    raise exception 'this consent is older than the server will accept on the device''s word'
      using errcode = '45008',
            detail = format('captured %s ago, the maximum is %s hours', v_lag, v_max_lag::integer),
            hint   = 'Sync sooner. This capture cannot be accepted; the visit record is '
                     'unaffected and the consent must be captured again.';
  end if;

  -- ---- bound 3: the version was the active one AT captured_at ---------------
  select * into v_displayed
    from public.consent_text_versions v where v.id = p_consent_text_version_id;
  if not found then
    raise exception 'consent text version % does not exist', p_consent_text_version_id
      using errcode = '22023';
  end if;

  v_active_then := public.active_consent_text_at(p_language, v_captured_at);
  if v_active_then.id is null then
    raise exception 'no active consent text for language % at %', p_language, v_captured_at
      using errcode = '22023';
  end if;

  if p_consent_text_version_id <> v_active_then.id then
    -- SQLSTATE 45001, unchanged from FIX-02, and it now means what it always claimed to
    -- mean. Before this migration it fired whenever the notice changed between capture
    -- and receipt; now it fires only when the version supplied was not the one that would
    -- have been on the screen at the moment the doctor was asked -- which is the only
    -- case where "re-read the current notice and ask again" is a remedy the MR can carry
    -- out.
    raise exception
      'the consent notice changed since it was displayed; re-read the current notice and ask again'
      using errcode = '45001',
            detail  = format('displayed %s, active at %s was %s, language %s',
                             p_consent_text_version_id, v_captured_at,
                             v_active_then.id, p_language);
  end if;

  insert into public.consent_records
    (id, visit_id, doctor_id, captured_by_mr_id, outcome, not_asked_reason,
     consent_text_version_id, displayed_language, captured_at)
  values
    (p_id, p_visit_id, v_visit.doctor_id, v_uid, p_outcome,
     case when p_outcome = 'not_asked' then p_not_asked_reason else null end,
     -- `displayed_language` from the version that was actually active then, not from the
     -- parameter, so a mismatched language cannot be recorded as if it had been displayed.
     p_consent_text_version_id, v_active_then.language, v_captured_at)
  returning * into v_row;

  return v_row;
end;
$function$
