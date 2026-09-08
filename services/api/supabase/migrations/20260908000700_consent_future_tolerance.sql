-- ============================================================================
-- MR-05 B1 - 45007 gets a tolerance, because it currently fires on an ordinary capture
--
-- FIX-12 refused any `captured_at` after the server clock. That is the right shape and
-- the wrong bound: **there is no tolerance at all**, and the client supplies
-- `captured_at` from the DEVICE clock. An online capture sent immediately arrives
-- milliseconds old, so a handset whose clock is a few seconds fast trips *"the device
-- clock is ahead of the server"* on the most ordinary capture the product has.
--
-- The handsets this app targets make it worse rather than better. MR scope section 6
-- names Xiaomi, Oppo, Vivo and Realme as the battery killers, and their power managers
-- are what stops background NTP sync from keeping a clock right. So the strictest bound
-- in the consent flow fires on the commonest case, on the commonest devices, and tells an
-- MR that something they cannot see is broken.
--
-- ----------------------------------------------------------------------------
-- IT DOES NOT WEAKEN THE CONTROL, AND THE ASYMMETRY IS THE POINT
-- ----------------------------------------------------------------------------
--
-- The tolerance applies to the FORWARD bound only. Backdating is untouched and still
-- governed by `consent_max_sync_lag_hours`, which is the bound that matters for a
-- capture claimed to have happened earlier than it did. Forward skew of a couple of
-- seconds is not an attack -- it is a phone -- and the two directions have different
-- adversaries.
--
-- ----------------------------------------------------------------------------
-- 120 SECONDS, AND IT IS UNVERIFIED
-- ----------------------------------------------------------------------------
--
-- Configurable in `app_thresholds` beside `consent_max_sync_lag_hours`, not written into
-- the function, and registered the way the UCPMP cap and the sync lag were. Two minutes
-- covers ordinary unsynchronised drift without opening a window anybody could use: a
-- forward-dated capture cannot make a stale notice look current, because the notice check
-- uses the same `captured_at` and moving it FORWARD makes a superseded version look worse
-- rather than better.
--
-- **UNVERIFIED: how much forward skew is acceptable is a compliance question, not an
-- engineering one.** It needs the same authority that owns the UCPMP cap and the maximum
-- sync lag. Zero disables the tolerance and restores the FIX-12 behaviour exactly.
--
-- ----------------------------------------------------------------------------
-- AND `capture_lag` CAN NOW BE NEGATIVE, WHICH IS THE POINT OF RECORDING IT
-- ----------------------------------------------------------------------------
--
-- `consent_records.capture_lag` is `received_at - captured_at`. FIX-12 asserted it could
-- never be negative, and that was true precisely because the forward bound was absolute.
-- A tolerated capture from a fast phone now stores a NEGATIVE lag -- which is the observed
-- skew, in the row, exactly where a device with a genuinely bad clock becomes a query
-- rather than an MR complaint. The FIX-12 assertion is updated rather than deleted, and
-- its test says why.
--
-- Rollback: services/api/rollbacks/20260908000700_consent_future_tolerance.down.sql
-- ============================================================================

insert into public.app_thresholds (key, value, unit, scope, note)
values (
  'consent_future_tolerance_seconds',
  '120'::jsonb,
  'seconds',
  'global',
  'How far ahead of the server clock a device may stamp captured_at before 45007 fires. '
  'UNVERIFIED and NOT ratified: 120s covers ordinary unsynchronised phone drift and is '
  'not a compliance answer. Set it from an authoritative source and record the source '
  'here. Zero restores the FIX-12 behaviour, which refused any forward skew at all and '
  'therefore fired on an ordinary online capture from a slightly fast handset. This '
  'bounds the FORWARD direction only -- backdating is governed by '
  'consent_max_sync_lag_hours and is deliberately untouched.'
);

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
  v_tolerance   numeric;
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
  -- MR-05 B1. A TOLERANCE on the forward bound, and only the forward one.
  --
  -- Without it, 45007 fires on the most ordinary capture there is. The client supplies
  -- `captured_at` from the DEVICE clock; an online capture sent immediately arrives
  -- milliseconds old; so a handset whose clock is a few seconds fast is told "your clock
  -- is wrong" for doing nothing unusual. And the handsets this product targets --
  -- Xiaomi, Oppo, Vivo, Realme -- are exactly the ones whose power managers kill the
  -- background sync that keeps a clock right.
  --
  -- This does NOT weaken the control. Backdating is untouched and still governed by
  -- `consent_max_sync_lag_hours`; the tolerance covers forward skew of a couple of
  -- seconds, which is not an attack, it is a phone.
  v_tolerance := coalesce(
    public.threshold_number('consent_future_tolerance_seconds', null, null), 0);

  if v_captured_at > now() + make_interval(secs => v_tolerance) then
    raise exception 'consent cannot be captured in the future'
      using errcode = '45007',
            detail = format(
              'captured_at %s is more than %s seconds after the server clock %s',
              v_captured_at, v_tolerance::integer, now()),
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
