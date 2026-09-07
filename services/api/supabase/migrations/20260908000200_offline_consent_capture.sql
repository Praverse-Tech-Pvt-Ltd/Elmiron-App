-- ============================================================================
-- FE-W?? / BE-W?? · Consent capture works offline, on a bounded and auditable trust
--
-- FIX-01 found that `capture_consent` recorded a consent version the doctor never saw.
-- FIX-02 fixed that by requiring the displayed version and refusing it if it was not the
-- ACTIVE one — active meaning active `now()`, at the moment the write landed on the
-- server. That was the right fix for the defect in front of it and it made offline
-- consent capture impossible:
--
--   an MR captures consent at 09:40 in a clinic with no signal
--   the notice is superseded at 14:00 by somebody in an office
--   the handset syncs at 18:00
--   -> 45001, "the notice changed since it was displayed"
--
-- The notice did not change since it was displayed. It changed since it was RECEIVED. A
-- content update on a Tuesday afternoon would refuse a whole day of field work, with the
-- doctors already gone, and the MR's only remedy — re-read the notice and ask again —
-- would be impossible to carry out.
--
-- ----------------------------------------------------------------------------
-- THE TRUST MODEL, STATED RATHER THAN IMPLIED
-- ----------------------------------------------------------------------------
--
-- **You cannot cryptographically establish when a doctor read something on a device you
-- do not control.** A server-issued token was considered and does not work here: the
-- token would be issued when the app FETCHED the notice, not when the doctor READ it, so
-- an app carrying a notice cached twenty days ago would present a token whose issue time
-- predates the supersession anyway. More machinery, same trust boundary.
--
-- So any offline consent capture trusts the handset for the moment of consent. This
-- design does not pretend otherwise. It **bounds** that trust and makes it **auditable**:
--
--   1. `captured_at` may not be in the future.        (45007 — the device clock is wrong)
--   2. `received_at - captured_at` may not exceed a configurable maximum.  (45008 — sync)
--   3. the supplied version must have been the active one AT `captured_at`. (45001 — ask again)
--   4. both timestamps are stored, and their difference is a stored column, so a
--      backdating pattern is a query rather than an inference.
--
-- Three distinct SQLSTATEs because the MR's remedy is different in each case and a client
-- that cannot tell them apart will tell the MR the wrong thing: fix your clock, sync, or
-- go back and ask again. That is the same reasoning that produced 45001 in FIX-02.
--
-- **The acceptance of a bounded client clock is a decision that needs client
-- ratification, not an engineering choice.** It is recorded in
-- `docs/adr-sync-pull.md` §6 and in PROJECT-OVERVIEW.md → FIX-12.
--
-- Rollback: services/api/rollbacks/20260908000200_offline_consent_capture.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The maximum sync lag, configurable and UNVERIFIED
-- ----------------------------------------------------------------------------
--
-- **72 hours, and the number is not ratified.** Unlike `ucpmp_sample_cap_quantity`, this
-- one is NOT left null: null here would mean unbounded trust in a client clock, which is
-- the thing being bounded. So there is a default, and it is labelled rather than asserted.
--
-- Why 72 and not something smaller: FE-G2 is "a full offline day", and the failure mode of
-- a value that is too SMALL is destroying legitimate field work with the doctors already
-- gone — the exact failure this migration exists to remove. 72 hours covers a weekend plus
-- a day, so the case the product promises can never be refused by this bound. The failure
-- mode of a value that is too LARGE is a wider window in which a wrong device clock is
-- accepted, which is visible in `capture_lag` rather than silent.
--
-- **UNVERIFIED: how long may a consent sit on a handset before it stops being acceptable
-- is a compliance question, not an engineering one.** It needs the same authority that
-- owns the UCPMP cap. Registered on the escalation list.
insert into public.app_thresholds (key, value, unit, scope, note)
values (
  'consent_max_sync_lag_hours',
  '72'::jsonb,
  'hours',
  'global',
  'Maximum age of an offline consent capture the server will accept, measured '
  'received_at - captured_at. UNVERIFIED and NOT ratified: 72h is chosen so that the '
  'full offline day FE-G2 promises can never be refused by this bound, and it is not a '
  'compliance answer. Set it from an authoritative source and record the source here. '
  'Not null, unlike ucpmp_sample_cap_quantity, because null would mean unbounded trust '
  'in a device clock, which is the thing this bounds.'
);

-- ----------------------------------------------------------------------------
-- 2. The gap between capture and receipt, as a column
-- ----------------------------------------------------------------------------
--
-- `captured_at` (the handset's claim) and `received_at` (the server's clock, defaulted to
-- clock_timestamp() and never supplied by a caller) were both already stored. What was
-- missing is the thing an auditor actually asks for: the DIFFERENCE, in the row, so that
-- "which MR's captures consistently arrive hours late" is a query rather than an
-- inference over two columns nobody joins.
--
-- Stored rather than computed on read, because a bounded trust that is only auditable if
-- somebody remembers to write the right expression is not auditable.
alter table public.consent_records
  add column capture_lag interval
  generated always as (received_at - captured_at) stored;

comment on column public.consent_records.capture_lag is
  'received_at - captured_at. The gap between the handset''s claim about when consent was '
  'given and the server''s clock when it arrived. Offline capture trusts the device for '
  'the first of those; this column is what makes that trust auditable rather than '
  'invisible. Bounded at capture time by consent_max_sync_lag_hours.';

-- ----------------------------------------------------------------------------
-- 3. Which notice was active at a given moment
-- ----------------------------------------------------------------------------
--
-- `active_consent_text(p_language)` has had this logic against `now()` since BE-W1. The
-- generalisation is the whole behavioural change in this migration: the same rule, asked
-- about a different instant.
--
-- Deliberately the same ordering (`effective_from desc, created_at desc, id desc`) so that
-- `active_consent_text_at(l, now())` and `active_consent_text(l)` cannot diverge — the
-- latter is redefined below to call the former, so there is one rule and not two.
create function public.active_consent_text_at(p_language text, p_at timestamptz)
returns public.consent_text_versions
language sql
stable
security definer
set search_path = ''
as $$
  select v.*
    from public.consent_text_versions v
   where v.language = p_language
     and v.effective_from <= p_at
     and (v.effective_until is null or v.effective_until > p_at)
   order by v.effective_from desc, v.created_at desc, v.id desc
   limit 1;
$$;

revoke execute on function public.active_consent_text_at(text, timestamptz) from public, anon;
grant execute on function public.active_consent_text_at(text, timestamptz) to authenticated;

comment on function public.active_consent_text_at(text, timestamptz) is
  'The notice that would have been displayed for a language at a given instant. '
  'active_consent_text(l) is this asked about now(), and is defined in terms of it so '
  'the two cannot drift apart.';

create or replace function public.active_consent_text(p_language text)
returns public.consent_text_versions
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.active_consent_text_at(p_language, now());
$$;

-- ----------------------------------------------------------------------------
-- 4. Capture, validated against the moment of capture
-- ----------------------------------------------------------------------------

create or replace function public.capture_consent(
  p_id                      uuid,
  p_visit_id                uuid,
  p_outcome                 public.consent_outcome,
  p_language                text,
  p_consent_text_version_id uuid,
  p_not_asked_reason        text        default null,
  p_captured_at             timestamptz default null
)
returns public.consent_records
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function public.capture_consent(
  uuid, uuid, public.consent_outcome, text, uuid, text, timestamptz) from public, anon;
grant execute on function public.capture_consent(
  uuid, uuid, public.consent_outcome, text, uuid, text, timestamptz) to authenticated;

comment on function public.capture_consent(
  uuid, uuid, public.consent_outcome, text, uuid, text, timestamptz) is
  'Validates the displayed consent version against the moment of CAPTURE rather than the '
  'moment of receipt, so a notice superseded while an MR was offline no longer destroys a '
  'day of field work. Trusts the handset for captured_at, deliberately and boundedly: '
  '45007 refuses a future capture, 45008 refuses one older than '
  'consent_max_sync_lag_hours, 45001 refuses a version that was not active at that '
  'moment, and consent_records.capture_lag records the gap permanently so backdating is '
  'detectable. See PROJECT-OVERVIEW.md -> FIX-12 for the trust model.';
