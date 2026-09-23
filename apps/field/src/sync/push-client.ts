import uuid from 'expo-modules-core/src/uuid';
import { SyncPushResponseSchema } from '@fieldforce/core';
import type {
  CreateCallReportRequest,
  CreateCheckInRequest,
  CreateCheckOutRequest,
  CreateConsentRecordRequest,
  CreateSampleAndInputRequest,
  SyncEntity,
  SyncRejectionCode,
} from '@fieldforce/core';
import { resolveClient } from '../capture/client';
import type { RpcCaller } from '../capture/client';
import { assertOwned, noteFolder } from '../capture/voice-note-files';
import type { VoiceNoteUpload } from './voice-note-upload';

/**
 * The five writes, through `sync_push` — MR-18 B1. This is what closes `G-WRITE`.
 *
 * **Every screen write in this app went to `127.0.0.1:4010`.** The modules that speak to
 * Supabase — `record_check_in`, `capture_consent`, `revise_call_report` — have been
 * complete and tested for sessions, and no screen reached any of them. This is the door.
 *
 * **One RPC, not five.** `apply_sync_item` already routes each entity to the function that
 * enforces its bounds: check-in and check-out through `record_check_in` / `record_check_out`
 * so geofence, shift window and the server clock apply; consent through `capture_consent`
 * so the three FIX-02/FIX-12 bounds apply on the offline path, which is the path they exist
 * for. A client that posted to five REST endpoints would be choosing which bounds to
 * inherit; going through `sync_push` means it cannot choose.
 *
 * **Shaped as the five `ApiClient` methods on purpose.** `sendFor`, `syncQueueReducer`,
 * `flushOutbox`, `QueueScreen` and the whole rejection path are already built around that
 * signature and are already tested. Changing the transport under them means the queue's
 * behaviour — ordering, retry, dead-lettering, exactly-once — is the behaviour that was
 * already proved, rather than something rewritten alongside the conversion.
 *
 * **EXACTLY ONCE is the server's, and the mechanism is `sync_items.id`.** `sync_push` looks
 * the item up by its id before applying it, and returns `duplicate` when it is already
 * `accepted` or `duplicate` — the branch is in the function, not here. The id is the
 * client's request id, which `outbox.ts` calls "device-generated, doubles as the
 * server-side idempotency key" and never regenerates on a retry. So a replay caused by a
 * LOST ACKNOWLEDGEMENT — the case that actually happens, where the write landed and the
 * answer did not — is deduplicated by the same row that recorded it.
 */

/**
 * A refusal from `sync_push`, carrying the SQLSTATE.
 *
 * **Not `ApiRequestError`, and the difference is the point.** That error models the REST
 * envelope: an `ApiErrorCode`, a request id, field errors — and no SQLSTATE, because
 * PostgREST's envelope is not this repo's error envelope. `sync_push` answers with a
 * per-item verdict that carries `sqlState`, which MR-17 B1 threaded all the way to the
 * queue screen so that 45001, 45004, 45007 and 45008 each reach the MR with their own
 * remedy. Flattening that back into an `ApiRequestError` would discard the field on the one
 * path that finally has it.
 */
export class SyncPushRefusal extends Error {
  readonly sqlState: string | null;
  readonly rejectionCode: SyncRejectionCode | null;
  readonly deadLettered: boolean;
  /**
   * BE-W97 — the server's own figures for this refusal, verbatim.
   *
   * `message` is the sentence; this is the numbers in it. For `45004` that is the cap, the
   * month-to-date total, this entry and the period — without which "this would go past the
   * UCPMP limit" is not something an MR can act on or repeat to their manager.
   *
   * Optional in the constructor because every existing caller predates it and a required
   * field would have been filled with `null` at each of them to keep the build quiet —
   * which is how a field arrives everywhere and means nothing anywhere.
   */
  readonly detail: string | null;
  readonly hint: string | null;

  constructor(args: {
    readonly message: string;
    readonly sqlState: string | null;
    readonly rejectionCode: SyncRejectionCode | null;
    readonly deadLettered: boolean;
    readonly detail?: string | null;
    readonly hint?: string | null;
  }) {
    super(args.message);
    this.name = 'SyncPushRefusal';
    this.sqlState = args.sqlState;
    this.rejectionCode = args.rejectionCode;
    this.deadLettered = args.deadLettered;
    this.detail = args.detail ?? null;
    this.hint = args.hint ?? null;
  }
}

/** What an accepted write hands back. Only `receivedAt` is read by anything today. */
export interface PushAccepted {
  /**
   * The SERVER's clock when it answered the batch — `SyncPushResponse.serverTime`.
   *
   * **Not the row's `received_at` and not the device's.** `sync_push` returns no per-row
   * timestamp, and the queue screen renders this under "Server recorded this at", so it has
   * to be a server value or none at all — MR-08 C5, where this field was filled with the
   * DEVICE clock and rendered behind those words. `serverTime` is the transaction's clock
   * for a row written inside that transaction, which is the closest true statement
   * available without a schema change.
   */
  readonly receivedAt: string;
}

/**
 * MR-51 D1 — what sending a voice note needs beyond `rpc`: the kept file, the audio bucket, and
 * one read. Injected so every rule in `uploadVoiceNote` is tested without a device, a bucket or a
 * network; `voice-note-device.ts` binds them to `expo-file-system` and `supabase-js`.
 */
export interface VoiceNoteDeps {
  /** Who is signed in NOW — the only rep whose folder may be opened. */
  readonly signedInUserId: () => Promise<string | null>;
  readonly documentRoot: () => string;
  readonly fileExists: (uri: string) => boolean;
  /** Bytes on disk, read from the file — the reservation `begin_upload` asks for. */
  readonly fileSize: (uri: string) => number;
  readonly fileBytes: (uri: string) => Promise<ArrayBuffer>;
  readonly removeFile: (uri: string) => void;
  /** Writes the bytes to `audio/<key>`, the key the server issued. Throws when it did not land. */
  readonly storeObject: (key: string, bytes: ArrayBuffer) => Promise<void>;
  /**
   * The server's `received_at` when this note already exists, else null. The lost-acknowledgement
   * case: the note landed and the answer did not.
   */
  readonly storedAt: (noteId: string) => Promise<string | null>;
}

export interface PushClientDeps {
  readonly client?: RpcCaller;
  /** Injected in tests. Production mints a batch id per call. */
  readonly newBatchId?: () => string;
  /** Injected in tests. Production binds the device (`voice-note-device.ts`) on first use. */
  readonly voiceNotes?: VoiceNoteDeps;
}

/**
 * The five methods, in the shape `sendFor` and the screens already call.
 *
 * Deliberately NOT the full `ApiClient`: the reads have moved to `sync_pull` and the audio
 * paths need an `uploadGrantId` only an upload session can mint (FE-W29). Declaring methods
 * this cannot honestly serve would put back the shape of the defect this conversion is
 * removing.
 */
export interface OutboxWriteClient {
  createCheckIn: (body: CreateCheckInRequest) => Promise<PushAccepted>;
  createCheckOut: (body: CreateCheckOutRequest) => Promise<PushAccepted>;
  createConsentRecord: (body: CreateConsentRecordRequest) => Promise<PushAccepted>;
  createSampleAndInput: (body: CreateSampleAndInputRequest) => Promise<PushAccepted>;
  createCallReport: (body: CreateCallReportRequest) => Promise<PushAccepted>;
  /** MR-51 D1 / `FE-W29`. Upload, then finalise through `sync_push`, then forget the phone's copy. */
  uploadVoiceNote: (body: VoiceNoteUpload) => Promise<PushAccepted>;
}

/**
 * A SQLSTATE from PostgREST is the server's verdict; anything else is no answer.
 *
 * Class `28` (not authenticated) is left as no answer on purpose: an expired session is fixed by
 * signing in again, and refusing the note for it would lose work the server never judged.
 */
const refusalOrSilence = (error: { code?: string | null; message: string }): Error => {
  const code = error.code ?? '';
  if (/^[0-9A-Z]{5}$/u.test(code) && !code.startsWith('28')) {
    return new SyncPushRefusal({
      message: error.message,
      sqlState: code,
      rejectionCode: null,
      deadLettered: false,
    });
  }
  return new Error(error.message);
};

const grantFrom = (data: unknown): { id: string; storageKey: string } => {
  const row = (Array.isArray(data) ? data[0] : data) as
    { id?: unknown; storage_key?: unknown } | null | undefined;
  if (typeof row?.id !== 'string' || typeof row.storage_key !== 'string') {
    throw new Error('begin_upload answered without a grant');
  }
  return { id: row.id, storageKey: row.storage_key };
};

interface Pushable {
  readonly id: string;
  readonly visitId: string;
}

export const createPushClient = (deps: PushClientDeps = {}): OutboxWriteClient => {
  // `expo-modules-core`'s uuid, matching `app/consent/[visitId].tsx` and
  // `app/report/[visitId].tsx`. NOT `expo-crypto`, which the first draft reached for and
  // which is not a declared dependency of this workspace -- adding one needs asking, and
  // the repository already had an answer.
  const newBatchId = deps.newBatchId ?? ((): string => uuid.v4());

  const push = (entity: SyncEntity, body: Pushable): Promise<PushAccepted> =>
    // `entityId` is the VISIT for every one of these five, matching what `outbox.ts`
    // already stores, so everything waiting on one visit groups together on the queue
    // screen. `id` is the request's own id and is never regenerated -- it is the
    // idempotency key.
    pushItem(entity, body.id, body.visitId, body);

  const pushItem = async (
    entity: SyncEntity,
    id: string,
    entityId: string,
    payload: object,
  ): Promise<PushAccepted> => {
    const db = await resolveClient<RpcCaller>(deps.client);
    const { data, error } = await db.rpc('sync_push', {
      p_batch_id: newBatchId(),
      p_items: [{ id, entity, entityId, payload }],
    });

    if (error !== null) {
      // A transport-level failure, or an RPC that never ran. NOT a refusal: the server has
      // said nothing about this item, so it must stay queued and be retried. Throwing a
      // plain Error rather than a SyncPushRefusal is what keeps `flushOutbox` treating it
      // as "no answer" rather than as a verdict.
      throw new Error(error.message);
    }

    // Parsed, never cast. This crosses a process boundary and is the only place that can
    // notice the server changed shape.
    const response = SyncPushResponseSchema.parse(data);
    const verdict = response.results.find((result) => result.id === id);
    if (verdict === undefined) {
      throw new Error(`sync_push returned no verdict for item ${id}`);
    }

    switch (verdict.status) {
      case 'accepted':
        return { receivedAt: response.serverTime };
      // **A duplicate is a SUCCESS, not a failure.** It means this exact item is already
      // recorded -- the write landed and the acknowledgement did not. Treating it as an
      // error would dead-letter work the server already holds, and asking the MR to do
      // something about it would be asking them to fix the network's memory.
      //
      // Written as its own arm rather than a fallthrough: `no-fallthrough` is on, and a
      // shared arm would put this reasoning where a reader cannot see which case it is
      // about.
      case 'duplicate':
        return { receivedAt: response.serverTime };
      case 'rejected':
      case 'dead_lettered':
        throw new SyncPushRefusal({
          // Backend's sentence, verbatim. Never reworded -- the queue screen renders
          // exactly this, and `rejectionDetail` is written for support rather than for
          // the MR, so it is the fallback and not the first choice.
          message: verdict.rejectionDetail ?? 'The server refused this.',
          sqlState: verdict.sqlState,
          rejectionCode: verdict.rejectionCode,
          deadLettered: verdict.status === 'dead_lettered',
          // BE-W97. The figures, carried beside the sentence rather than folded into it,
          // so a screen can render them under the remedy and a screen that does not want
          // them is unchanged.
          detail: verdict.sqlDetail,
          hint: verdict.sqlHint,
        });
    }
  };

  return {
    createCheckIn: (body) => push('check_in', body),
    // A departure pushes as a departure. Its absence from `sendFor` is what made every
    // queued check-out arrive as an arrival (MR-08), and the entity is named here for the
    // same reason it is named there: two functions rather than one with a flag, so a call
    // site cannot pick the wrong default.
    createCheckOut: (body) => push('check_out', body),
    createConsentRecord: (body) => push('consent_record', body),
    createSampleAndInput: (body) => push('sample_and_input', body),
    createCallReport: (body) => push('call_report', body),
    uploadVoiceNote: async (body) => {
      const notes = deps.voiceNotes ?? (await import('./voice-note-device')).deviceVoiceNotes;

      // Only the signed-in rep's own folder is opened (MR-50 D). The queue is already per rep
      // (MR-49), so this cannot normally differ; if it does, nothing is read or sent.
      const signedIn = await notes.signedInUserId();
      if (signedIn === null || signedIn !== body.userId) {
        throw new Error('This note belongs to a different sign-in, so it was not sent.');
      }
      const root = notes.documentRoot();
      const uri = `${noteFolder(root, body.userId)}${encodeURIComponent(body.noteId)}.m4a`;
      assertOwned(uri, root, signedIn);

      // The acknowledgement lost last time: the note is already the server's. Forget the copy.
      // Without this a retry would take a SECOND grant and upload the bytes again -- the row
      // would still be written once (the sync item id and the note id both deduplicate), but
      // an orphan object would sit in the bucket until the stale-session sweep.
      const already = await notes.storedAt(body.noteId);
      if (already !== null) {
        if (notes.fileExists(uri)) notes.removeFile(uri);
        return { receivedAt: already };
      }

      if (!notes.fileExists(uri)) {
        // Neither here nor there. Not a server verdict, so it takes the outbox's own path:
        // a failed attempt, visible, and eventually a person's problem.
        throw new Error('This voice note is no longer on this phone, so it cannot be sent.');
      }

      const db = await resolveClient<RpcCaller>(deps.client);
      const size = notes.fileSize(uri);
      const began = await db.rpc('begin_upload', {
        p_visit_id: body.visitId,
        p_kind: 'voice_note',
        p_size_bytes: size,
        p_duration_seconds: body.durationSeconds,
      });
      if (began.error !== null) throw refusalOrSilence(began.error);
      const grant = grantFrom(began.data);

      await notes.storeObject(grant.storageKey, await notes.fileBytes(uri));

      // The finalisation, as the ordinary sync item it is. `entityId` is the NOTE here, not the
      // visit: `apply_sync_item` hands it to `complete_upload` as the object id. `sizeBytes` is
      // sent because the signature has it; the server stores what Storage observed.
      const accepted = await pushItem('voice_note', body.id, body.noteId, {
        uploadGrantId: grant.id,
        durationSeconds: body.durationSeconds,
        sizeBytes: size,
        recordedAt: body.recordedAt,
      });

      // Only now, with the server's acceptance in hand, does the phone's copy go (MR-51 D3).
      try {
        notes.removeFile(uri);
      } catch {
        // The server has it. A copy that could not be deleted is tidied by the next save's
        // listing, not reported as a failed send.
      }
      return accepted;
    },
  };
};
