import { LIVE_TRACKING_RPC, LiveTrackingStatusSchema, PingVerdictSchema } from '@fieldforce/core';
import type { LiveTrackingStatus, PingVerdict } from '@fieldforce/core';
import { callRpc } from '../live-rest';
import type { LiveConnection } from '../live-rest';

/**
 * `FE-W71` / `BE-W180` — live tracking on the REAL server, as the signed-in rep.
 *
 * Four RPCs and nothing else (`20261013000100_live_tracking`): the status, accepting the notice that
 * was READ, withdrawing, and one position. Every answer is parsed with the contract's schema, so a
 * server that answers a different shape is a loud failure here, not a quiet wrong state on screen.
 *
 * **Why a position is sent now or never, and not queued in the outbox.** The outbox
 * (`src/sync/outbox.ts`) exists so that work the rep DID survives a day without signal: a check-in,
 * a report, a consent. A live position is worth something only while it is live — the server
 * refuses one older than ten minutes (`too_old`) and judges working hours at the moment it ARRIVES,
 * so a position queued in a basement and sent at 19:05 would be refused anyway. Queuing would also
 * put twelve items an hour on the rep's "not sent yet" list and on their sign-out warning. So a
 * position that fails to send is dropped, and the status line says the last one did not reach the
 * company. Each carries its own id, so a resend after a dropped RESPONSE is still one position.
 */
export interface Position {
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number | null;
  /** The device's time, ISO. The server bounds it and stamps its own beside it. */
  readonly recordedAt: string;
}

export interface LiveTrackingBackend {
  status(): Promise<LiveTrackingStatus>;
  /** Accept the notice version that was shown. Refused `45001` if it has been replaced since. */
  accept(noticeVersionId: string): Promise<LiveTrackingStatus>;
  withdraw(): Promise<LiveTrackingStatus>;
  ping(position: Position): Promise<PingVerdict>;
}

export const createLiveTrackingBackend = (c: LiveConnection): LiveTrackingBackend => ({
  status: async () =>
    LiveTrackingStatusSchema.parse(await callRpc(c, LIVE_TRACKING_RPC.myLiveTracking, {})),
  accept: async (noticeVersionId) =>
    LiveTrackingStatusSchema.parse(
      await callRpc(c, LIVE_TRACKING_RPC.acceptNotice, { p_notice_version_id: noticeVersionId }),
    ),
  withdraw: async () =>
    LiveTrackingStatusSchema.parse(await callRpc(c, LIVE_TRACKING_RPC.withdraw, {})),
  ping: async (position) =>
    PingVerdictSchema.parse(
      await callRpc(c, LIVE_TRACKING_RPC.recordPing, {
        p_id: position.id,
        p_latitude: position.latitude,
        p_longitude: position.longitude,
        p_accuracy_m: position.accuracyM,
        p_recorded_at: position.recordedAt,
      }),
    ),
});
