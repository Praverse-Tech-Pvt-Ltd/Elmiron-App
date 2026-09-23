-- Rollback for MR-53 B1/B2 -- removes the read the client asks and the consent predicate it shares.
-- The flag row is NOT removed: `app_thresholds` is append-only by trigger, and a row saying the
-- recording feature is OFF is the correct state to leave behind in any case.

drop function if exists public.recording_permission(uuid);
drop function if exists public.standing_consent_for_visit(uuid);
