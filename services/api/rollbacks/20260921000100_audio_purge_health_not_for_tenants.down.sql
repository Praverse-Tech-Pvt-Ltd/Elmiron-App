-- Rollback for MR-46 B3 -- audio_purge_health() revoked from signed-in users.
--
-- ****************************************************************************
-- WHAT APPLYING THIS MEANS: IT RE-OPENS A CROSS-TENANT READ.
-- ****************************************************************************
--
-- This restores the grant from `20260815000300_audio_consent_retention.sql` line 869, and
-- with it the defect: any MR of any company can again read every company's recording and
-- voice-note counts. It exists because `verify:rollbacks` requires every migration to have
-- one. It is not an operational option.
--
-- The forward migration's postcondition guard is deliberately NOT reproduced here -- it would
-- fail, because its whole purpose is to refuse the state this file creates.

grant execute on function public.audio_purge_health() to authenticated;
