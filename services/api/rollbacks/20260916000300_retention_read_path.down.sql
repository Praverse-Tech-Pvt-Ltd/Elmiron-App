-- Rollback for BE-W15 -- the retention read path.
--
-- WHAT APPLYING THIS MEANS. The console cannot read retention figures again, and the
-- retention PERIOD goes back to being a bare literal inside the trigger. That second half is
-- the one to notice: `stamp_audio_retention` is restored to the inline `interval '90 days'`
-- it carried before, so the number exists in one place again -- but only because the only
-- other reader is being removed in the same breath. If anything else has started calling
-- `audio_retention_days()` since, this rollback breaks it.
--
-- Restores `stamp_audio_retention` byte-for-byte as 20260815000300_audio_consent_retention.sql
-- left it, which is the version BE-W15 was written against.

CREATE OR REPLACE FUNCTION public.stamp_audio_retention()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.received_at := clock_timestamp();
  new.purge_after := new.received_at + interval '90 days';
  return new;
end;
$function$;

drop function if exists public.retention_status(text);
drop function if exists public.audio_retention_days();
