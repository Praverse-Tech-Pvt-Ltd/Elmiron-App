-- ============================================================================
-- MR-07 C - BE-W79: a consent notice belongs to a tenant
--
-- `consent_text_versions` had NO organisation column, and `active_consent_text_at`
-- returned the newest notice for a language across EVERY tenant. MR-06 proved that made
-- a cross-tenant denial of service. MR-07 C1 traced the READ path and it is worse than
-- that: it is a DISCLOSURE, confirmed on all three counts against the live database as
-- an ordinary MR of tenant A, with tenant B holding a later notice in the same language.
--
--   (a) THE LIST. `select ... from consent_text_versions` returned BOTH rows, including
--       `TENANT B CONFIDENTIAL NOTICE` in full. `consent_text_versions_select_authenticated`
--       is `using (true)`, so every client reads every other client's legal drafting.
--
--   (b) THE RESOLVER. `active_consent_text('c1-lang')` -- the call behind
--       `/consent-text-versions/active`, which is what populates the consent screen --
--       returned TENANT B's notice to tenant A's MR. **The app would display another
--       company's legal document to a doctor.**
--
--   (c) THE CAPTURE. `capture_consent` against tenant B's notice SUCCEEDED, because
--       tenant B's notice genuinely was the active one. Tenant A now holds a consent
--       record attesting that a doctor agreed to a document tenant A never wrote, and
--       tenant B is named in a consent it never issued.
--
-- Both branches are real and which one fires is an accident of ordering. If the client
-- displays the globally-active notice, it is (c) -- a corrupt consent record. If it
-- displays its own, it is the MR-06 denial of service -- `45001` on every capture. The
-- DoS half fails closed and is the better outcome of the two.
--
-- **This needs no privilege at all.** BE-W76 needed an admin; this needs an ordinary
-- tenant publishing an ordinary notice.
--
-- ----------------------------------------------------------------------------
-- THE FIX IS THE BE-W76 PATTERN, THIRD TIME OF ASKING
-- ----------------------------------------------------------------------------
--
-- A tenant column on the row, one helper expressing the caller's tenant, and the scope
-- resolved where the lookup happens rather than restated per call site. MR-06 predicted
-- the clinical tables would inherit this; `consent_text_versions` inherits it first.
--
-- **The tenant is derived from the ROW, not the session, wherever a row exists.**
-- `validate_consent_capture` runs for `postgres` as well as `authenticated` -- it has no
-- `auth.uid()` to consult -- so it resolves the tenant through `new.doctor_id`. That is
-- also the more honest question: the notice that matters is the one belonging to the
-- organisation whose doctor was asked, not the one belonging to whoever is connected.
--
-- ----------------------------------------------------------------------------
-- C3 - EXISTING ROWS, AND A DECISION NOT TAKEN HERE
-- ----------------------------------------------------------------------------
--
-- On every environment this repository can reach, `consent_text_versions` is populated
-- only by the test fixtures and by `seed:reference` -- there is no production deployment
-- and `seed-reference-data.mjs` refuses to invent content. So the backfill below is a
-- no-op on a fresh database and the count is zero.
--
-- **Where it is not zero, this migration resolves it or STOPS.** With exactly one
-- organisation present the answer is not a choice. With more than one it is a decision
-- about whose legal document is whose, and a migration that guessed would attribute one
-- company's consent notice to another -- which is the defect, performed by the fix. The
-- exception names the rows and leaves it to a human.
--
-- ----------------------------------------------------------------------------
-- AND THE UNIQUE CONSTRAINT WAS CROSS-TENANT TOO
-- ----------------------------------------------------------------------------
--
-- `consent_text_versions_unique_label_language UNIQUE (version_label, language)` meant
-- tenant B could not publish a notice labelled `v1` in `en-IN` because tenant A already
-- had one -- a second, quieter cross-tenant coupling on the same table, and one that
-- would have surfaced as an inexplicable `23505` on a customer's first day. It becomes
-- `UNIQUE (organisation_id, version_label, language)`.
--
-- Rollback: services/api/rollbacks/20260908001200_consent_text_versions_tenant.down.sql
-- ============================================================================

alter table public.consent_text_versions add column organisation_id uuid;

comment on column public.consent_text_versions.organisation_id is
  'The tenant whose legal document this is. MR-07 / BE-W79: without it '
  'active_consent_text_at returned the newest notice for a language across every '
  'tenant, so one company could display, and capture consent against, another '
  'company''s notice.';

-- C3. Resolve unambiguously, or stop. See the header.
do $$
declare
  v_rows integer;
  v_orgs integer;
  v_org  uuid;
begin
  select count(*) into v_rows from public.consent_text_versions;
  if v_rows = 0 then
    raise notice 'MR-07 C3: consent_text_versions is empty; nothing to attribute.';
    return;
  end if;

  select count(*), min(id) into v_orgs, v_org from public.organisations;

  if v_orgs = 1 then
    update public.consent_text_versions set organisation_id = v_org;
    raise notice 'MR-07 C3: attributed % notice(s) to the only organisation %', v_rows, v_org;
  else
    raise exception
      'MR-07 / BE-W79: % consent notice(s) exist and there are % organisations, so their '
      'owner cannot be derived. Set consent_text_versions.organisation_id for each by '
      'hand BEFORE applying this migration. Attributing one company''s consent notice to '
      'another is the defect this migration exists to close.', v_rows, v_orgs
      using errcode = '23502';
  end if;
end
$$;

alter table public.consent_text_versions alter column organisation_id set not null;

alter table public.consent_text_versions
  add constraint consent_text_versions_organisation_id_fkey
  foreign key (organisation_id) references public.organisations (id) on delete restrict;

-- Two tenants may legitimately both call a notice "v1" in "en-IN".
alter table public.consent_text_versions
  drop constraint if exists consent_text_versions_unique_label_language;
alter table public.consent_text_versions
  add constraint consent_text_versions_unique_label_language
  unique (organisation_id, version_label, language);

-- The resolver's predicate, in the order it filters.
create index consent_text_versions_tenant_language_idx
  on public.consent_text_versions (organisation_id, language, effective_from desc);

-- ----------------------------------------------------------------------------
-- The resolvers. The two-argument form is REPLACED, not kept beside a new one.
-- ----------------------------------------------------------------------------
--
-- Dropping it rather than leaving an unscoped overload is the point. An overload that
-- still answers "the active notice for a language, across everybody" is the defect with
-- a longer name, and the next caller to reach for the shorter signature would reopen it
-- without touching a line of this migration.

drop function if exists public.active_consent_text_at(text, timestamptz);

create or replace function public.active_consent_text_at(
  p_language text,
  p_at timestamptz,
  p_organisation_id uuid
)
returns public.consent_text_versions
language sql
stable
security definer
set search_path to ''
as $$
  select v.*
    from public.consent_text_versions v
   where v.organisation_id = p_organisation_id
     and v.language = p_language
     and v.effective_from <= p_at
     and (v.effective_until is null or v.effective_until > p_at)
   order by v.effective_from desc, v.created_at desc, v.id desc
   limit 1;
$$;

revoke execute on function public.active_consent_text_at(text, timestamptz, uuid) from public;

-- The client-facing form keeps its single argument and resolves the tenant itself, so a
-- caller cannot ask for somebody else's notice. There is no parameter to abuse.
create or replace function public.active_consent_text(p_language text)
returns public.consent_text_versions
language sql
stable
security definer
set search_path to ''
as $$
  select *
    from public.active_consent_text_at(
      p_language, now(), public.current_user_organisation_id());
$$;

revoke execute on function public.active_consent_text(text) from public;
grant execute on function public.active_consent_text(text) to authenticated;

-- ----------------------------------------------------------------------------
-- The list the consent screen builds its language picker from.
-- ----------------------------------------------------------------------------
--
-- `using (true)` is what disclosed tenant B's notice text in C1(a). The picker is meant
-- to offer the languages the server has a notice in; it was offering the languages
-- EVERY server tenant has a notice in, which is both a leak and a picker that can offer
-- a language this tenant cannot actually produce a notice in.

drop policy if exists consent_text_versions_select_authenticated on public.consent_text_versions;

create policy consent_text_versions_select_own_tenant on public.consent_text_versions
  for select to authenticated
  using (organisation_id = public.current_user_organisation_id());

-- ----------------------------------------------------------------------------
-- capture_consent resolves within the doctor's tenant.
-- ----------------------------------------------------------------------------

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
  v_org         uuid;
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

  -- MR-07 / BE-W79. The notice is resolved WITHIN THE DOCTOR'S TENANT.
  --
  -- Derived from the visit's doctor rather than from `auth.uid()`, and the two are the
  -- same tenant today because MR-06 made a user's organisation follow their territory.
  -- The doctor is used anyway because it is the honest question: the notice that matters
  -- is the one belonging to the company whose doctor was asked. It also matches what the
  -- trigger must do, which has no session to consult.
  select d.organisation_id into v_org
    from public.doctors d where d.id = v_visit.doctor_id;

  if v_org is null then
    raise exception 'doctor % has no organisation', v_visit.doctor_id
      using errcode = '22023';
  end if;

  v_active_then := public.active_consent_text_at(p_language, v_captured_at, v_org);
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
$function$;

-- ----------------------------------------------------------------------------
-- And the BE-W78 capture trigger, which called the two-argument resolver this
-- migration drops. Replaced rather than left to fail at runtime: dropping a
-- function does not invalidate a plpgsql body that names it, so the trigger would
-- have stayed green until the first insert.
-- ----------------------------------------------------------------------------

create or replace function public.validate_consent_capture()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_tolerance   numeric;
  v_max_lag     numeric;
  v_lag         interval;
  v_active_then public.consent_text_versions%rowtype;
  v_org         uuid;
begin
  -- A withdrawal is a different record with different rules, and
  -- `validate_consent_withdrawal` already bounds it three ways (MR-06 / BE-W77).
  if new.supersedes_consent_record_id is not null or new.is_withdrawal then
    return new;
  end if;

  -- ---- 45007: forward, beyond the tolerance ----
  -- Order mirrors `capture_consent`: forward first, then lag. A device whose clock is a
  -- day fast would otherwise trip the lag bound and be told to sync sooner, which is the
  -- wrong remedy for the right symptom.
  v_tolerance := coalesce(
    public.threshold_number('consent_future_tolerance_seconds', null, null), 0);

  if new.captured_at > now() + make_interval(secs => v_tolerance) then
    raise exception 'consent cannot be captured in the future'
      using errcode = '45007',
            detail = format(
              'captured_at %s is more than %s seconds after the server clock %s',
              new.captured_at, v_tolerance::integer, now()),
            hint   = 'The device clock is ahead of the server. Correct it and sync '
                     'again; do not re-ask the doctor.';
  end if;

  -- ---- 45008: older than the maximum sync lag ----
  v_max_lag := public.threshold_number('consent_max_sync_lag_hours', null, null);
  v_lag := now() - new.captured_at;

  if v_max_lag is not null and v_lag > make_interval(hours => v_max_lag::integer) then
    raise exception 'consent is older than the maximum sync lag'
      using errcode = '45008',
            detail = format('captured %s ago, the maximum is %s hours',
                            v_lag, v_max_lag::integer),
            hint   = 'This consent was valid when it was taken and arrived too late to '
                     'accept on the device''s word. Escalate it; do not re-ask the doctor.';
  end if;

  -- ---- 45001: the version stored must be the one active AT captured_at ----
  --
  -- This is the bound that makes the row mean something. Without it the record says a
  -- doctor was shown a notice, and nothing has checked that the notice existed when they
  -- were shown it.
  -- MR-07 / BE-W79: within the DOCTOR'S tenant. This trigger fires for `postgres` as
  -- well as `authenticated` and therefore has no `auth.uid()` to consult, so the tenant
  -- must come from the row. That is also the right question -- see capture_consent.
  select d.organisation_id into v_org
    from public.doctors d where d.id = new.doctor_id;

  if v_org is null then
    raise exception 'doctor % has no organisation', new.doctor_id using errcode = '22023';
  end if;

  v_active_then := public.active_consent_text_at(
    new.displayed_language, new.captured_at, v_org);

  if v_active_then.id is null then
    raise exception 'no active consent text for language % at %',
      new.displayed_language, new.captured_at
      using errcode = '22023',
            hint = 'The row claims a notice was displayed in a language that had no '
                   'active version at that moment.';
  end if;

  if new.consent_text_version_id <> v_active_then.id then
    raise exception
      'the consent notice changed since it was displayed; re-read the current notice and ask again'
      using errcode = '45001',
            detail = format(
              'stored %s, active at %s was %s, language %s',
              new.consent_text_version_id, new.captured_at, v_active_then.id,
              new.displayed_language);
  end if;

  return new;
end
$$;

