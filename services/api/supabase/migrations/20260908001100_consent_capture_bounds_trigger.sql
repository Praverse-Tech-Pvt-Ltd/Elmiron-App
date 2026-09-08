-- ============================================================================
-- MR-07 B - BE-W78: the consent bounds stop being optional
--
-- `authenticated` held a direct `INSERT` grant on `public.consent_records`, and
-- `consent_records_insert_own` permitted the row. So an ordinary MR could POST straight
-- to the table and never call `capture_consent` -- verified against the live database:
--
--     insert into public.consent_records (..., captured_at)
--     values (..., now() + interval '1 year');      -- INSERT 0 1
--
-- A consent dated a year in the future, accepted, by an ordinary MR, on the ordinary
-- REST path the app is being converted to use.
--
-- **That made six sessions of work optional.** FIX-02 established consent integrity.
-- FIX-12 made it work offline with three bounds -- 45001 notice superseded, 45007
-- captured in the future, 45008 older than the maximum sync lag. BE-W74 routed the sync
-- path through `capture_consent` so those bounds applied offline. Every one of them lives
-- in a function body, and **a function is not a guard when the table is writable.**
--
-- This repo already has the rule, written down after FIX-05: *a guard which is not a
-- trigger, a policy or a revoked grant is not a guard.* The capture bounds were none of
-- the three.
--
-- ----------------------------------------------------------------------------
-- BOTH HALVES, BECAUSE EITHER ALONE LEAVES A DOOR
-- ----------------------------------------------------------------------------
--
-- **The revoke alone is not enough.** It closes today's door. It does not stop the next
-- migration re-granting INSERT for a good reason, or a future `service_role` path, or
-- anything reached with `BYPASSRLS`. A grant is a fact about one role at one moment.
--
-- **The trigger alone is not enough either.** It would hold the rule, but it would leave
-- a writable table whose policy says an MR may insert consent records directly -- an
-- invitation, and one that the next person to read `consent_records_insert_own` would
-- reasonably accept.
--
-- So: revoke the grant, drop the policy that blessed it, AND put the bounds where they
-- fire regardless of which door a row arrives through. This is exactly what MR-06 did for
-- the WITHDRAWAL, and the asymmetry it left behind -- a withdrawal bounded on every path
-- while the capture it supersedes was bounded on one -- is what this closes.
--
-- ----------------------------------------------------------------------------
-- WHAT STILL WRITES TO THE TABLE, AND HOW, AFTER THE REVOKE
-- ----------------------------------------------------------------------------
--
--   * `capture_consent` -- SECURITY DEFINER, owned by `postgres`, and `postgres` has
--     `rolbypassrls = true`. It is unaffected by both the grant and the policy. This is
--     the only door the app has left.
--   * `apply_sync_item` -- SECURITY DEFINER, same owner. Its `consent_record` branch
--     calls `capture_consent` (BE-W74) and its withdrawal branch inserts directly; both
--     run with the definer's rights.
--   * `cascade_consent_withdrawal` -- a trigger, running inside those statements.
--   * The test fixtures -- as `postgres`, which is why the revoke does not touch them.
--     They are also why this migration is felt: a trigger fires for every role, including
--     the ones a grant never governed.
--   * `anon` and `service_role` hold no INSERT on this table and never did.
--
-- ----------------------------------------------------------------------------
-- THE THREE BOUNDS ARE THE SAME THREE, NOT A SECOND SET
-- ----------------------------------------------------------------------------
--
-- Same thresholds (`consent_future_tolerance_seconds`, `consent_max_sync_lag_hours`),
-- same SQLSTATEs (45007, 45008, 45001), same resolver (`active_consent_text_at`). Two
-- definitions of a valid capture would be worse than one in the wrong place: they would
-- drift, and the drift would show up as a row accepted by one door and refused by the
-- other.
--
-- `capture_consent` keeps its own copies deliberately. It raises BEFORE writing, so it
-- can give a caller a message about a payload rather than a message about a row -- and it
-- checks things a trigger cannot see, like whether the caller owns the visit. The trigger
-- is the floor, not a replacement.
--
-- Rollback: services/api/rollbacks/20260908001100_consent_capture_bounds_trigger.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The grant, and the policy that blessed it.
-- ----------------------------------------------------------------------------

revoke insert on public.consent_records from authenticated;

-- Dropped rather than left inert. A permissive INSERT policy on a table nobody may insert
-- into is a loaded gun with the magazine removed: the day somebody re-grants INSERT --
-- for a new service, a new role, a migration that restores a default -- the door opens
-- again in silence, because the policy that authorises it is still sitting there.
-- With no policy and RLS FORCED, a restored grant still writes nothing.
drop policy if exists consent_records_insert_own on public.consent_records;

-- ----------------------------------------------------------------------------
-- 2. The bounds, where every door passes through them.
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
  v_active_then := public.active_consent_text_at(new.displayed_language, new.captured_at);

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

revoke execute on function public.validate_consent_capture() from public;

-- Fires before `consent_records_validate_withdrawal` -- 'c' sorts before 'w' -- which is
-- irrelevant to correctness because each returns early on the other's rows, and is noted
-- so nobody has to work it out twice.
create trigger consent_records_validate_capture
  before insert on public.consent_records
  for each row execute function public.validate_consent_capture();
