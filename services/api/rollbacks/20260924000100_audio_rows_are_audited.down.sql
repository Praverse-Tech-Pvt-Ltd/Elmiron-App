-- Rollback for MR-54 `BE-W112` -- stops auditing the audio rows again.
--
-- The audit_log ROWS already written are not removed, and could not be: the table is
-- append-only by trigger, and a trail that can be rewound is not a trail. Rolling this back
-- means "record no more of these", never "unrecord the ones taken".

drop trigger if exists recordings_audit on public.recordings;
drop trigger if exists voice_notes_audit on public.voice_notes;
drop trigger if exists upload_grants_audit_insert_delete on public.upload_grants;
drop trigger if exists upload_grants_audit_state_change on public.upload_grants;
