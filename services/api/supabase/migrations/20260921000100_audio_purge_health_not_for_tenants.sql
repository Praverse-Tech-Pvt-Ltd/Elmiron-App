-- ============================================================================
-- MR-46 B3 -- BE-W106 (half): audio_purge_health() is not for any signed-in user.
-- ============================================================================
--
-- WHAT WAS OPEN
--
-- `audio_purge_health()` is SECURITY DEFINER and counts EVERY company's recordings and voice
-- notes -- live, overdue, abandoned, destroyed. `20260815000300_audio_consent_retention.sql`
-- line 869 granted it to `authenticated`, so any MR of any company could call it.
--
-- Measured before this migration, on the local stack: an MR of `DEMO Pharma 1ae08971`, a
-- company with NO recordings of its own, read `liveObjectCount = 56` -- every one of them
-- another company's. Counts, not personal data; but recording volume between competing
-- pharmaceutical companies is commercially sensitive on its own.
--
-- WHY IT SURVIVED
--
-- `20260916000300_retention_read_path.sql` says, twice, that this function "is a
-- whole-database view and is granted to nobody for exactly that reason". It was granted.
-- The claim was written, not measured, and it is the reason the retention panel was built
-- on `retention_status()` instead -- correctly -- while the open grant stayed.
--
-- WHY REVOKE, AND NOT "RESTRICT TO ADMINS" OR SCOPE IT
--
-- * `admin` is a TENANT administrator (`.ai-collab/decisions.md` C1; MR-42 A2 relied on the
--   same decision). Granting this to admins would hand every company's admin every other
--   company's counts -- the same leak with a smaller audience.
-- * Scoping it would change what the watchdog measures. Its callers are
--   `scripts/check-purge-health.mjs` (the scheduled "Audio retention watchdog") and two
--   specs; all of them connect as the database owner, and all of them need the WHOLE
--   database, because a purge that has stopped is stopped for everyone.
-- * The per-company view already exists: `retention_status()` -- admin-only, audited, and
--   bounded by `visible_user_ids()`.
--
-- No signed-in caller exists, so nothing a user does changes. Grep located the callers; the
-- ACL and a rolled-back probe decided it.

revoke execute on function public.audio_purge_health() from public, anon, authenticated;

-- ---- postcondition: asserts its own preconditions, and fails rather than half-applying ----
do $$
begin
  if has_function_privilege('authenticated', 'public.audio_purge_health()', 'execute') then
    raise exception 'MR-46 B3: authenticated can still execute audio_purge_health()';
  end if;
  if has_function_privilege('anon', 'public.audio_purge_health()', 'execute') then
    raise exception 'MR-46 B3: anon can execute audio_purge_health()';
  end if;
  -- The watchdog's role must keep it, or this has traded a leak for a blind watchdog.
  if not has_function_privilege('postgres', 'public.audio_purge_health()', 'execute') then
    raise exception 'MR-46 B3: postgres lost audio_purge_health() -- the watchdog would go blind';
  end if;
end;
$$;
