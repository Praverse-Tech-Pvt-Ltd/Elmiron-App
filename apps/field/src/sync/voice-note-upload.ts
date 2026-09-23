/**
 * MR-51 D1 — `FE-W29`: what a queued voice note carries, and how it is read back.
 *
 * A voice note goes to the server as an ORDINARY sync item (`entity: 'voice_note'`), so it has the
 * outbox's retry, per-rep ownership and dead-lettering rather than a second mechanism beside them.
 * The server already decided the rest: `apply_sync_item` finalises a `voice_note` item through
 * `complete_upload`, which needs the bytes already in Storage under a key only `begin_upload` issues.
 * So the queued row carries what the device knows — which note, whose, for which visit, how long —
 * and the grant, the key and the byte count are asked of the server at send time.
 *
 * **No size is stored.** `complete_upload` stores the size Storage observed (`FE-W46`); the device's
 * figure is only the reservation `begin_upload` asks for, read from the file when it is sent.
 */
export interface VoiceNoteUpload {
  /** The sync item's id — the server's idempotency key. Never regenerated on a retry. */
  readonly id: string;
  /** The `voice_notes` row the server creates, and the kept file's name. */
  readonly noteId: string;
  readonly visitId: string;
  /** The rep whose folder holds the file. Checked against whoever is signed in at send time. */
  readonly userId: string;
  readonly durationSeconds: number;
  /** When the MR recorded it — the device's own act, which only the device can know. */
  readonly recordedAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/**
 * A stored queue payload, back as an upload — or null when it is not one.
 *
 * Null rather than a throw, as `outbox.ts` does for every entity: one unreadable row must not stop
 * the rest of the day's work. The `__queueEntity` discriminant is checked first, for the reason
 * `payloadIs` gives: a row whose body is not what its slot says is refused, not trusted.
 */
export const voiceNoteUploadFrom = (payload: Record<string, unknown>): VoiceNoteUpload | null => {
  if (payload['__queueEntity'] !== 'voice_note') return null;
  const { id, noteId, visitId, userId, durationSeconds, recordedAt } = payload;
  if (!isUuid(id) || !isUuid(noteId) || !isUuid(visitId)) return null;
  if (typeof userId !== 'string' || userId.length === 0) return null;
  if (typeof durationSeconds !== 'number' || !Number.isInteger(durationSeconds)) return null;
  if (durationSeconds <= 0) return null;
  if (typeof recordedAt !== 'string' || Number.isNaN(Date.parse(recordedAt))) return null;
  return { id, noteId, visitId, userId, durationSeconds, recordedAt };
};
