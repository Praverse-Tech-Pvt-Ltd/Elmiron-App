# Flow

How execution actually travels. Written because the audio path crosses SQL, HTTP and
a Node worker, and no single file shows the whole trip.

Update when you touch a path, not all at once.

---

## Consent → recording → destruction (the whole trip)

**Entry point:** `capture_consent(...)` — RPC, called by the field app.

Calls into, in order:

1. `capture_consent` → `active_consent_text(lang)` — the version comes from the
   server catalogue. There is deliberately **no version parameter**; a client
   reporting it displayed v4 when v5 is current is either stale or lying and there is
   no way to tell which.
2. `begin_upload(visit, kind, size, duration)` — the gate. In order:
   `visit_is_quarantined` → kind/bounds → ownership → **standing consent** → reuse an
   open session if one exists → `audio_purge_is_stalled` → `audio_storage_bytes`
   against the ceiling → insert the grant with an opaque key and two clocks.
3. Client PUTs/POSTs bytes to `/storage/v1/object/audio/{key}`. Three policies on
   `storage.objects` all call `has_live_upload_grant(name)`. **No grant, no bytes.**
4. `record_upload_progress` / `resume_upload` → `assert_upload_still_permitted`
   — **consent first**, then session state, then clocks. The order matters; see
   BE-W7 §2.
5. `complete_upload` → final consent check → insert `recordings` → mark the grant
   `completed` + `consumed_at`. The `stamp_audio_retention` trigger sets
   `received_at` and `purge_after` here, from the server clock.
6. Destruction, by either of two routes into the *same* machinery:
   - **Withdrawal:** insert into `consent_records` fires
     `cascade_consent_withdrawal` → revokes open grants → deletes redacted
     transcripts, then raw, then analyses → marks the recording `claimed` with
     `purge_after = now()`.
   - **Retention:** `purge_after` simply passes.
7. `scripts/purge-expired-audio.mjs` (cron) →
   `close_stale_upload_sessions()` → `claim_expired_audio()` →
   `deleteStorageObject()` over HTTP → `confirm_audio_destroyed()` →
   `finish_audio_purge_run()`.

**Assumes exists:** a private `audio` bucket; the `llm_gateway` role; `sha256_hex`;
`reject_mutation`; `visible_user_ids`.

**The non-obvious bit:** step 7 is the only place an object is actually deleted. SQL
cannot delete a storage object, so **every destruction path ends in that Node
worker** — the trigger in step 6 only *marks*. If the worker stops, nothing is
destroyed, which is why step 2 refuses new uploads when it detects that.

## Offline sync → an upload landing

**Entry point:** `sync_push(batch_id, items)`.

- Per item, inside its own exception block (its own savepoint) →
  `apply_sync_item(entity, id, payload)`.
- `entity in ('recording','voice_note')` → `complete_upload(...)`. So a finalisation
  that arrives a day late goes through **exactly the same consent and clock checks**
  as a live one.
- A raise is caught by `sync_push` and mapped to a `sync_rejection_code` — **by
  message text** for the three upload cases, because they are ordinary `42501` /
  `22023` conditions that already mean something else. Each mapping has its own test;
  a reworded message breaks a build rather than silently degrading an MR's
  explanation.
- The MR reads it back through `my_upload_queue()`, which left-joins
  `sync_item_explained` on `payload ->> 'uploadGrantId'`.

## Post-restore reconciliation

**Entry point:** `scripts/reconcile-after-restore.mjs` — **dry run unless `--apply`.**

- `begin_restore_reconciliation()` → every key the DB believes is live.
- `listAllKeys()` walks the bucket over HTTP, one prefix level at a time.
- Compares **both directions**, and re-verifies each finding individually before
  acting — the walk is a smear across time, not a snapshot, so an upload that started
  mid-walk would otherwise look like an orphan.
- `reconcile_row_without_object` → destroys the row, and **quarantines the visit** if
  it was a recording.
- `reconcile_object_without_row` → deletes the object.

**The reason it cannot use `storage.objects`:** that table is in the same database
and a restore rewinds it too. Comparing it against `public.recordings` compares two
things that travelled back together and finds nothing.
