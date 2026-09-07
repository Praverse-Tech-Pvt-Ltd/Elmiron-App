import type {
  ConsentRecord,
  CreateRecordingRequest,
  CreateVoiceNoteRequest,
} from '@fieldforce/core';

/**
 * Phase 3 D6 and D7 — the rules around the microphone, away from the renderer.
 *
 * > **A consultation may be recorded only when a doctor said yes on screen, and
 * > this module is where the device proves it before the microphone opens.**
 * >
 * > The server checks too — `CreateRecordingRequestSchema.consentRecordId` is
 * > required and the row is rejected unless that record's outcome is `consented`.
 * > That is the check that counts, because it is the one an MR cannot reach. This
 * > one exists so the refusal happens *before* audio is captured rather than after:
 * > a recording made and then rejected is a recording that existed on a phone in a
 * > doctor's room, and deleting it afterwards does not undo that.
 */

export type RecordingBlock =
  /** No consent record for this visit at all — the question was never put. */
  | { readonly kind: 'never_asked' }
  /** The doctor said no, or the consent was withdrawn. */
  | { readonly kind: 'refused' }
  /** The MR has not granted the microphone. */
  | { readonly kind: 'no_microphone' };

/**
 * Why a consultation recording cannot start, or null when it can.
 *
 * **Withdrawal beats consent whatever the order of the rows.** The ledger is
 * append-only and a withdrawal is a new row with `supersedesConsentRecordId` set,
 * so "what stands now" is the latest capture — reading the earliest would let a
 * withdrawn consent authorise a recording.
 */
export const recordingBlock = (
  records: readonly ConsentRecord[],
  microphoneGranted: boolean,
): RecordingBlock | null => {
  if (!microphoneGranted) return { kind: 'no_microphone' };

  const latest = [...records].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1);

  if (latest === undefined) return { kind: 'never_asked' };
  if (latest.isWithdrawal) return { kind: 'refused' };
  return latest.outcome === 'consented' ? null : { kind: 'refused' };
};

/** The consent record a recording is authorised by, or null when none authorises one. */
export const authorisingConsent = (records: readonly ConsentRecord[]): ConsentRecord | null => {
  const latest = [...records].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1);
  if (latest === undefined || latest.isWithdrawal) return null;
  return latest.outcome === 'consented' ? latest : null;
};

/** What the MR is told, in their words, for each reason the microphone stays shut. */
export const blockReason = (block: RecordingBlock): string => {
  switch (block.kind) {
    case 'never_asked':
      return 'Ask the doctor first. Nothing can be recorded until they have answered on this phone.';
    case 'refused':
      return 'The doctor said no. Nothing will be recorded, and that is the end of it — carry on with the visit.';
    case 'no_microphone':
      return 'The microphone is off for this app. Turn it on in Settings if you want to record with the doctor’s agreement.';
  }
};

export interface RecordingDraft {
  readonly id: string;
  readonly visitId: string;
  readonly consentRecordId: string;
  readonly durationSeconds: number;
  readonly bitrateKbps: number;
  readonly sizeBytes: number;
  readonly recordedAt: string;
}

/**
 * The request body for a finished recording.
 *
 * `recordedAt` is when capture *started*, not when the upload was built — on a
 * recording pushed hours later those differ, and the one that describes when the
 * doctor was in the room is the start.
 */
export const recordingRequest = (draft: RecordingDraft): CreateRecordingRequest => ({
  id: draft.id,
  visitId: draft.visitId,
  consentRecordId: draft.consentRecordId,
  durationSeconds: draft.durationSeconds,
  bitrateKbps: draft.bitrateKbps,
  recordedAt: draft.recordedAt,
  sizeBytes: draft.sizeBytes,
});

export interface VoiceNoteDraft {
  readonly id: string;
  readonly visitId: string;
  readonly durationSeconds: number;
  readonly sizeBytes: number;
  readonly recordedAt: string;
}

/**
 * The request body for a voice note.
 *
 * **No consent record, and that is not an omission.** A voice note has no third
 * party in it — it is the MR dictating to themselves — and
 * `onboarding/microphone.tsx` already refuses to collapse the two into one
 * sentence about "recording". Requiring a doctor's consent for the MR's own note
 * would be the app treating them as a subject of their own notes.
 */
export const voiceNoteRequest = (draft: VoiceNoteDraft): CreateVoiceNoteRequest => ({
  id: draft.id,
  visitId: draft.visitId,
  durationSeconds: draft.durationSeconds,
  recordedAt: draft.recordedAt,
  sizeBytes: draft.sizeBytes,
});

/** "02:41" — elapsed capture, from whole seconds. */
export const elapsedLabel = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * The bar's own sentence, naming when the doctor agreed.
 *
 * The design puts the agreement time in the indicator — "Recording · he agreed at
 * 11:58" — so the authority for what is happening is visible on the same line as
 * the fact of it. Gendered pronouns are out for the reason the consent copy
 * records: nothing here knows a doctor's pronouns either.
 */
export const recordingLabel = (agreedAtClock: string): string =>
  `Recording · agreed at ${agreedAtClock}`;
