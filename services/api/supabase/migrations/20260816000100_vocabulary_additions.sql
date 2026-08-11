-- ============================================================================
-- BE-W7 (1 of 5) · Enum values only
--
-- This file exists solely because of a Postgres rule: `ALTER TYPE ... ADD VALUE`
-- may be written inside a transaction, but the new label is not usable until that
-- transaction COMMITS. Each Supabase migration file is one transaction, so adding
-- a value and using it needs two files. The same rule produced the 000100/000200
-- split in BE-W6.
--
-- Nothing here does anything on its own. Everything that uses these labels lives in
-- 20260816000300, 000400 and 000500.
--
-- Rollback: services/api/rollbacks/20260816000100_vocabulary_additions.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Why audio gets destroyed
-- ----------------------------------------------------------------------------

-- A partial upload the MR never finished. It is an object, it may contain audio,
-- and if the visit was abandoned there is no recording row binding it to anything.
-- It is destroyed on the same schedule as everything else, and the reason it went
-- is recorded honestly rather than being filed under 'retention'.
alter type public.audio_destruction_reason add value 'abandoned_upload';

-- A database restore rewound the row but not the object. The audio is gone and we
-- cannot tell from the database whether retention or a withdrawal took it, because
-- the evidence of either was in the rows the restore discarded. Recording the
-- honest answer — "destroyed, cause unrecoverable" — beats guessing one.
alter type public.audio_destruction_reason add value 'restore_reconciled';

-- ----------------------------------------------------------------------------
-- Why a queued upload was refused
-- ----------------------------------------------------------------------------

-- The two ways a QUEUED upload can fail that the existing vocabulary describes
-- wrongly. Both would otherwise land as `validation_failed`, whose sentence to an MR
-- is 'the server refused the contents of this item' — untrue and unactionable for
-- both. Both are reachable in ordinary use: a doctor withdraws while the device is
-- offline, or the device syncs the finalisation after the grant's hard ceiling.
alter type public.sync_rejection_code add value 'consent_withdrawn';
alter type public.sync_rejection_code add value 'upload_expired';

-- A third, `storage_ceiling_exceeded`, was drafted and then dropped. The ceiling is
-- checked in `begin_upload`, which the client calls interactively because it needs
-- the object key before it can send a byte — so the refusal reaches the caller
-- directly and never travels through the queue. A rejection code no code path can
-- produce is a vocabulary entry that looks like coverage and is not.
