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

  constructor(args: {
    readonly message: string;
    readonly sqlState: string | null;
    readonly rejectionCode: SyncRejectionCode | null;
    readonly deadLettered: boolean;
  }) {
    super(args.message);
    this.name = 'SyncPushRefusal';
    this.sqlState = args.sqlState;
    this.rejectionCode = args.rejectionCode;
    this.deadLettered = args.deadLettered;
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

export interface PushClientDeps {
  readonly client?: RpcCaller;
  /** Injected in tests. Production mints a batch id per call. */
  readonly newBatchId?: () => string;
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
}

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

  const push = async (entity: SyncEntity, body: Pushable): Promise<PushAccepted> => {
    const db = await resolveClient<RpcCaller>(deps.client);
    const { data, error } = await db.rpc('sync_push', {
      p_batch_id: newBatchId(),
      // `entityId` is the VISIT for every one of these five, matching what `outbox.ts`
      // already stores, so everything waiting on one visit groups together on the queue
      // screen. `id` is the request's own id and is never regenerated -- it is the
      // idempotency key.
      p_items: [{ id: body.id, entity, entityId: body.visitId, payload: body }],
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
    const verdict = response.results.find((result) => result.id === body.id);
    if (verdict === undefined) {
      throw new Error(`sync_push returned no verdict for item ${body.id}`);
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
  };
};
