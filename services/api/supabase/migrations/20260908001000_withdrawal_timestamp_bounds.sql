-- ============================================================================
-- MR-06 C - BE-W77: a withdrawal gets the bounds its consent already has
--
-- MR-05 established that `validate_consent_withdrawal` checks the original's existence,
-- its outcome, its doctor and that it is not itself a withdrawal -- and NEVER looks at
-- `captured_at`. The column is NOT NULL with no default and no check constraint, so a
-- withdrawal five years in the past and one a year in the future were both accepted,
-- while the same future instant was refused `45007` on a capture.
--
-- **A withdrawal is the record that decides whether everything processed since the
-- original consent was lawful.** Both directions are attacks and they have different
-- attackers:
--
--   * BACKDATING retroactively makes past processing unlawful -- a way to manufacture a
--     breach, or to paper over one that already happened.
--   * FORWARD-DATING delays a withdrawal the doctor has already given, which is the
--     DPDP s.6(4) violation itself.
--
-- There is no argument for a withdrawal being LESS bounded than the consent it withdraws.
--
-- ----------------------------------------------------------------------------
-- WHY THIS IS IN THE TRIGGER AND NOT IN A FUNCTION
-- ----------------------------------------------------------------------------
--
-- Found while writing this and it decided the placement. `authenticated` holds a direct
-- `INSERT` grant on `public.consent_records`, and `consent_records_insert_own` permits
-- the row, so an MR can insert a consent record over PostgREST WITHOUT going through
-- `capture_consent` at all. Verified against the live database as `authenticated`:
--
--     insert into public.consent_records (..., captured_at)
--     values (..., now() + interval '1 year');
--     -- INSERT 0 1
--
-- A capture dated a year in the future, accepted, because every one of `capture_consent`'s
-- bounds -- 45001, 45007, 45008 -- lives in a function the caller simply did not call.
-- BE-W74 routed the SYNC path through `capture_consent`; the REST path was never routed
-- anywhere. **Registered as BE-W78 and NOT fixed here** -- moving the capture bounds to a
-- trigger, or revoking the INSERT grant so `capture_consent` is the only door, is a
-- change with its own blast radius and it deserves its own session rather than being
-- bolted onto this one.
--
-- But it settles where the WITHDRAWAL bound goes. A trigger fires on every path -- REST,
-- `sync_push`, psql, a future service -- and this repo's own rule is that a guard which
-- is not a trigger, a policy or a revoked grant is not a guard. So the withdrawal is now
-- bounded strictly better than the capture it supersedes, which is the right way round
-- for the record that governs lawfulness.
--
-- ----------------------------------------------------------------------------
-- C2: THE SQLSTATES ARE REUSED, NOT MINTED
-- ----------------------------------------------------------------------------
--
-- `45007` and `45008`, the same two a capture raises, because **the remedy is identical
-- and the remedy is what a code is for.** A device clock that is ahead is fixed the same
-- way whether it stamped a consent or a withdrawal; a record too old to accept on the
-- device's word is escalated the same way. `packages/core` already maps both to
-- `consent_captured_in_future` and `consent_too_old_to_accept`, both `actionable: true`,
-- and `error-contract.spec.ts` guards that map in BOTH directions.
--
-- Minting 45009 and 45010 would add two entries whose explanations would be word for word
-- the two that exist. That is the decoration B2 of the contract test exists to refuse: a
-- mapping for a refusal that cannot be told apart from another makes the real entries
-- harder to read, and the MR would see the same sentence either way.
--
-- **The MESSAGE differs where the situation differs.** Re-asking a doctor to withdraw is
-- worse than re-asking for consent -- it says the withdrawal did not register, to the one
-- person who has already exercised the right -- so the hints say so.
--
-- The third bound has no counterpart on the capture side and gets `23514`: a withdrawal
-- cannot predate the consent it supersedes. The sync-lag bound does not cover this. A
-- consent captured an hour ago and withdrawn "two hours ago" is inside 72 hours and still
-- incoherent, and it is the cheapest form of the backdating attack.
--
-- Rollback: services/api/rollbacks/20260908001000_withdrawal_timestamp_bounds.down.sql
-- ============================================================================

create or replace function public.validate_consent_withdrawal()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_original  public.consent_records%rowtype;
  v_tolerance numeric;
  v_max_lag   numeric;
  v_lag       interval;
begin
  if new.supersedes_consent_record_id is null then
    return new;
  end if;

  select * into v_original
    from public.consent_records c
   where c.id = new.supersedes_consent_record_id;

  if not found then
    raise exception 'consent record % does not exist', new.supersedes_consent_record_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_original.outcome <> 'consented' then
    raise exception 'consent record % has outcome %; only a granted consent can be withdrawn',
      v_original.id, v_original.outcome
      using errcode = 'check_violation';
  end if;

  if v_original.doctor_id <> new.doctor_id then
    raise exception 'withdrawal is for doctor % but the original consent is for doctor %',
      new.doctor_id, v_original.doctor_id
      using errcode = 'check_violation';
  end if;

  if v_original.is_withdrawal then
    raise exception 'consent record % is itself a withdrawal', v_original.id
      using errcode = 'check_violation';
  end if;

  -- ---- MR-06 / BE-W77. The three bounds. ----
  --
  -- Order matters and mirrors `capture_consent`: forward first, then lag. A device whose
  -- clock is a day fast would otherwise trip the lag bound and be told to sync sooner,
  -- which is the wrong remedy for the right symptom.

  -- 1. Forward, beyond the tolerance a capture gets. Same threshold, deliberately: two
  --    numbers for one question is two numbers to keep in step, and they would drift.
  v_tolerance := coalesce(
    public.threshold_number('consent_future_tolerance_seconds', null, null), 0);

  if new.captured_at > now() + make_interval(secs => v_tolerance) then
    raise exception 'a consent withdrawal cannot be captured in the future'
      using errcode = '45007',
            detail = format(
              'captured_at %s is more than %s seconds after the server clock %s',
              new.captured_at, v_tolerance::integer, now()),
            hint   = 'The device clock is ahead of the server. Correct it and sync '
                     'again. Do not ask the doctor to withdraw again -- they have '
                     'already exercised the right and the record is the problem.';
  end if;

  -- 2. Older than the maximum sync lag. A withdrawal claimed to have happened days ago
  --    and arriving now cannot be taken on the device's word, for the same reason a
  --    capture cannot: everything processed in between turns on which is true.
  v_max_lag := public.threshold_number('consent_max_sync_lag_hours', null, null);
  v_lag := now() - new.captured_at;

  if v_max_lag is not null and v_lag > make_interval(hours => v_max_lag::integer) then
    raise exception 'a consent withdrawal is older than the maximum sync lag'
      using errcode = '45008',
            detail = format('captured %s ago, the maximum is %s hours',
                            v_lag, v_max_lag::integer),
            hint   = 'This withdrawal was valid when it was taken and arrived too late '
                     'to accept on the device''s word. Escalate it; do not ask the '
                     'doctor to withdraw again.';
  end if;

  -- 3. Before the consent it supersedes. No counterpart on the capture side, and the lag
  --    bound does not cover it: a consent captured an hour ago and withdrawn "two hours
  --    ago" is well inside 72 hours and still describes a withdrawal that happened before
  --    there was anything to withdraw.
  if new.captured_at < v_original.captured_at then
    raise exception
      'withdrawal captured at %s predates the consent %s it supersedes, captured at %s',
      new.captured_at, v_original.id, v_original.captured_at
      using errcode = '23514',
            hint = 'A withdrawal cannot precede the consent it withdraws. Backdating one '
                   'retroactively makes lawful processing unlawful.';
  end if;

  return new;
end
$$;
