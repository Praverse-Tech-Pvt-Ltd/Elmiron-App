-- Rollback for 20260908001200_consent_text_versions_tenant.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- **This reopens BE-W79, which MR-07 C1 established is a DISCLOSURE and not only a
-- denial of service.** After this runs, and proven against the live database as an
-- ordinary MR:
--
--   * every client can read every other client's consent notice text in full;
--   * `active_consent_text(language)` -- the call behind the consent screen -- returns
--     whichever tenant published most recently, so the app can DISPLAY another company's
--     legal document to a doctor;
--   * a capture against that notice SUCCEEDS, and the consent record then attests that a
--     doctor agreed to a document the capturing tenant never wrote.
--
-- The alternative branch is no better: where the client displays its own notice, every
-- capture fails `45001` because another tenant's is the active one. That half fails
-- closed and is the better of the two outcomes.
--
-- Apply this BEFORE 20260908000800's rollback: `active_consent_text` below depends on
-- `current_user_organisation_id()`, which that file drops. Note also that this restores
-- `UNIQUE (version_label, language)` WITHOUT the tenant, so it will FAIL if two tenants
-- have each published a notice with the same label and language -- which is legitimate
-- data under the migration being reversed. Resolve those rows by hand first.

-- The capture trigger, back to the unscoped resolver.
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
begin
  if new.supersedes_consent_record_id is not null or new.is_withdrawal then
    return new;
  end if;

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

  v_active_then := public.active_consent_text_at(new.displayed_language, new.captured_at);

  if v_active_then.id is null then
    raise exception 'no active consent text for language % at %',
      new.displayed_language, new.captured_at
      using errcode = '22023';
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

revoke execute on function public.validate_consent_capture() from public;

-- The list, back to world-readable.
drop policy if exists consent_text_versions_select_own_tenant on public.consent_text_versions;
create policy consent_text_versions_select_authenticated on public.consent_text_versions
  for select to authenticated
  using (true);

-- The resolvers, back to unscoped.
drop function if exists public.active_consent_text(text);
drop function if exists public.active_consent_text_at(text, timestamptz, uuid);

create or replace function public.active_consent_text_at(p_language text, p_at timestamptz)
returns public.consent_text_versions
language sql
stable
security definer
set search_path to ''
as $$
  select v.*
    from public.consent_text_versions v
   where v.language = p_language
     and v.effective_from <= p_at
     and (v.effective_until is null or v.effective_until > p_at)
   order by v.effective_from desc, v.created_at desc, v.id desc
   limit 1;
$$;

revoke execute on function public.active_consent_text_at(text, timestamptz) from public;

create or replace function public.active_consent_text(p_language text)
returns public.consent_text_versions
language sql
stable
security definer
set search_path to ''
as $$
  select * from public.active_consent_text_at(p_language, now());
$$;

revoke execute on function public.active_consent_text(text) from public;
grant execute on function public.active_consent_text(text) to authenticated;

-- capture_consent, back to resolving the notice without a tenant.
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
$function$;

-- The column and its constraints.
drop index if exists public.consent_text_versions_tenant_language_idx;

alter table public.consent_text_versions
  drop constraint if exists consent_text_versions_unique_label_language;
alter table public.consent_text_versions
  add constraint consent_text_versions_unique_label_language
  unique (version_label, language);

alter table public.consent_text_versions
  drop constraint if exists consent_text_versions_organisation_id_fkey;

alter table public.consent_text_versions drop column if exists organisation_id;
