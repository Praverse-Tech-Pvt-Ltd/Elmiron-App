import { RecordingPermissionSchema } from '@fieldforce/core';
import type { RecordingPermission } from '@fieldforce/core';
import { resolveClient } from './client';
import type { RpcCaller } from './client';

/**
 * MR-53 B1 — asking the server whether this visit may be recorded.
 *
 * **Why this is a round trip and not a local computation.** `sync_pull` does not carry
 * `consent_record` (MR-21 B6, a declared phase-2 omission), so the phone holds no consent ledger.
 * The alternative to asking would be shipping the ledger and re-deriving the consent rule on the
 * device — two copies of the one rule that decides whether a doctor's words may be recorded.
 *
 * **Both halves of the flag are checked, and the client's half is checked FIRST.** `C3` stands:
 * scope §8.6 needs a named PV/DPDP signatory. A build that was never allowed to record does not
 * even ask the server, so nothing in the audit trail suggests it tried.
 */
export type RecordingAvailability =
  /** Draw the control. `consentRecordId` is the row the recording will cite. */
  | {
      readonly kind: 'allowed';
      readonly consentRecordId: string;
      /** When the doctor agreed, from the server. The screen shows it while recording. */
      readonly consentCapturedAt: string;
    }
  /** Draw nothing, and say nothing: the feature is off, which is not a fact about the doctor. */
  | { readonly kind: 'off' }
  /**
   * Draw nothing, and say this.
   *
   * `why` is carried beside the sentence because the SCREEN knows something the server cannot:
   * a consent answer captured on this phone and still queued. The server says `never_asked` --
   * truthfully, it has not received one -- and `describeWitnessed` tells the MR the fuller truth.
   */
  | {
      readonly kind: 'blocked';
      readonly why: RecordingPermission['reason'];
      readonly sentence: string;
    }
  /** The server could not be asked. Draw nothing, and do not claim a reason. */
  | { readonly kind: 'unknown' };

/**
 * What the MR is told for each server reason.
 *
 * `never_asked` and `declined` keep MR-49's sentences — they were written for this screen and the
 * distinction between them is the point. `withdrawn` gets its own, because "the doctor said no" is
 * false of somebody who agreed and then changed their mind.
 */
const SENTENCE: Record<string, string> = {
  never_asked: 'Ask the doctor first. Nothing can be recorded until they have answered.',
  declined:
    'The doctor said no. Nothing will be recorded, and that is the end of it — carry on with the visit.',
  withdrawn:
    'The doctor agreed and then changed their mind. Nothing more can be recorded for this visit.',
  quarantined:
    'This visit is being checked after a problem with the server’s records. Recording is off until somebody clears it.',
};

export const availabilityFrom = (permission: RecordingPermission): RecordingAvailability => {
  if (
    permission.allowed &&
    permission.consentRecordId !== null &&
    permission.consentCapturedAt !== null
  ) {
    return {
      kind: 'allowed',
      consentRecordId: permission.consentRecordId,
      consentCapturedAt: permission.consentCapturedAt,
    };
  }
  // `feature_off` and `not_your_visit` are both silences: one is a build-time decision, the other
  // is a question this rep may not ask, and neither is something to tell them about the doctor.
  const sentence = SENTENCE[permission.reason];
  return sentence === undefined
    ? { kind: 'off' }
    : { kind: 'blocked', why: permission.reason, sentence };
};

/**
 * Ask the server. `unknown` on any failure — offline, refused, or a shape this build cannot read.
 *
 * Never `allowed` by accident: every path that is not an explicit yes draws no control.
 */
export const recordingAvailability = async (
  visitId: string,
  client?: RpcCaller,
): Promise<RecordingAvailability> => {
  // Imported on USE, not at module load: `../config` calls `loadAppConfig` at import time and
  // throws on a missing `EXPO_PUBLIC_*` value -- deliberately, so a misconfigured build fails on
  // the first screen. Same reason `resolveClient` imports `../supabase` lazily.
  //
  // **A configuration that cannot be read is OFF, not unknown.** A build that cannot establish it
  // is allowed to record is a build that is not allowed to record; fail closed, and ask nothing.
  let enabled = false;
  try {
    enabled = (await import('../config')).appConfig.recordingEnabled;
  } catch {
    return { kind: 'off' };
  }
  if (!enabled) return { kind: 'off' };

  try {
    const db = await resolveClient<RpcCaller>(client);
    const { data, error } = await db.rpc('recording_permission', { p_visit_id: visitId });
    if (error !== null) return { kind: 'unknown' };
    return availabilityFrom(RecordingPermissionSchema.parse(data));
  } catch {
    return { kind: 'unknown' };
  }
};
