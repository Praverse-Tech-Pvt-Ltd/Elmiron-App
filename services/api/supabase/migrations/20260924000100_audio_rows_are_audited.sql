-- ============================================================================
-- MR-54 (continued) · `BE-W112` — the recording is audited, not only the consent
-- ============================================================================
--
-- **The asymmetry this closes, measured rather than assumed.** From the live catalogue:
-- sixteen tables carried `write_audit_row`, among them `consent_records`, `visits`,
-- `analyses` and `adverse_event_reports` — and `recordings`, `voice_notes` and
-- `upload_grants` carried none. `recordings` had exactly two triggers,
-- `recordings_stamp_retention` and `recordings_require_consent`. So after MR-54 A2 put four
-- real recordings on the server, `audit_log` held **zero** rows about them.
--
-- The system recorded that a doctor agreed, and did not record that audio of them was made.
-- The agreement was ABOUT the audio; the artefact it authorises is the one thing the trail
-- did not mention.
--
-- **What was already covered, said plainly so this is not oversold.** DESTRUCTION is not the
-- gap: `audio_destruction_log` has recorded what was destroyed, when, why and under which
-- purge run since `20260815000300`, deliberately without the storage key in the clear. The
-- gap is CREATION, and the change of custody that precedes it.
--
-- **Why `upload_grants` updates are filtered and the other two are not.**
-- `record_upload_progress` updates a grant ON EVERY CHUNK — `bytes_received`, `chunk_count`,
-- `last_progress_at`, a sliding `expires_at` — and never touches `state`. An unfiltered
-- trigger would write one audit row per chunk and bury the transitions that matter
-- (`issued -> completed`, `issued -> revoked`) under progress noise. A trail nobody can read
-- is the same failure as no trail, arrived at from the other side. So the grant is audited on
-- insert, on delete, and on a `state` change; `recordings` and `voice_notes` are audited on
-- everything, because their updates are rare and every one of them matters — a purge claim, a
-- withdrawal stamp, a destruction.
--
-- **The actor may be null, and that is correct.** `write_audit_row` writes `auth.uid()` and
-- `current_app_role()`, both null for the purge worker and the retention job, and `audit_log`
-- declares both columns nullable. A job is not a person and the row should not pretend one
-- was there. Checked before writing this: `current_app_role()` reads the JWT with `nullif`
-- and cannot raise for an unauthenticated caller, so adding a trigger to `recordings` does
-- not put the purge worker at risk of failing on a row it is entitled to change.
--
-- Rollback: services/api/rollbacks/20260924000100_audio_rows_are_audited.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Preconditions, asserted rather than assumed
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.write_audit_row()') is null then
    raise exception 'BE-W112: write_audit_row() does not exist; 20260811000300 has not run';
  end if;

  -- The three tables, and the one column the filtered trigger keys on. A `when` clause
  -- naming a column that has been renamed would fail at CREATE TRIGGER, but saying so here
  -- names the reason rather than leaving a syntax error to be interpreted.
  if to_regclass('public.recordings') is null
     or to_regclass('public.voice_notes') is null
     or to_regclass('public.upload_grants') is null then
    raise exception 'BE-W112: one of recordings / voice_notes / upload_grants is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'upload_grants' and column_name = 'state'
  ) then
    raise exception 'BE-W112: upload_grants.state is missing, so the grant filter cannot work';
  end if;

  -- The claim this migration is built on. If any of the three already had the trigger, the
  -- measurement in the register was wrong and the next reader should know before trusting it.
  if exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
     where p.proname = 'write_audit_row'
       and not t.tgisinternal
       and c.relname in ('recordings', 'voice_notes', 'upload_grants')
  ) then
    raise exception
      'BE-W112: one of these tables is already audited, so this migration is built on a '
      'measurement that has since changed. Re-measure before applying.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- The triggers
-- ----------------------------------------------------------------------------

create trigger recordings_audit
  after insert or update or delete on public.recordings
  for each row execute function public.write_audit_row();

create trigger voice_notes_audit
  after insert or update or delete on public.voice_notes
  for each row execute function public.write_audit_row();

create trigger upload_grants_audit_insert_delete
  after insert or delete on public.upload_grants
  for each row execute function public.write_audit_row();

-- Only a state change. See the header: progress is per chunk and would drown the transitions.
create trigger upload_grants_audit_state_change
  after update on public.upload_grants
  for each row
  when (old.state is distinct from new.state)
  execute function public.write_audit_row();

-- ----------------------------------------------------------------------------
-- The guard on what was just done
-- ----------------------------------------------------------------------------
do $$
declare
  v_audited integer;
begin
  select count(*) into v_audited
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
   where p.proname = 'write_audit_row'
     and not t.tgisinternal
     and c.relname in ('recordings', 'voice_notes', 'upload_grants');

  if v_audited <> 4 then
    raise exception 'BE-W112: expected 4 audit triggers across the three tables, found %',
      v_audited;
  end if;

  -- CONTENT, not just the count: the grant's update trigger must carry a `when` clause, or
  -- it is the flooding version wearing the right name.
  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname = 'upload_grants'
       and t.tgname = 'upload_grants_audit_state_change'
       and not t.tgisinternal
       and pg_get_triggerdef(t.oid) ilike '%when %state%'
  ) then
    raise exception
      'BE-W112: the upload_grants update trigger has no state filter, so it would write an '
      'audit row per chunk.';
  end if;
end;
$$;

comment on trigger recordings_audit on public.recordings is
  'BE-W112. A recording is audio of a named doctor; its creation belongs in the same trail '
  'as the consent that authorised it. Destruction is separate and older: audio_destruction_log.';

comment on trigger upload_grants_audit_state_change on public.upload_grants is
  'BE-W112. State changes only. record_upload_progress updates this row on every chunk '
  'without touching state, and an unfiltered trigger would bury issued -> revoked under it.';
