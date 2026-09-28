/**
 * FE-D2 first run — when A4 (the microphone rationale) is due.
 *
 * Operator ruling (28 September): the first time the rep OPENS a visit — the design's "Before your
 * first visit" — if the microphone is not already granted and A4 has not been answered. Answered
 * either way, it is never due again.
 *
 * Android only: `RECORD_AUDIO` is an Android runtime permission, and this app is Android-only.
 * Pure, with the platform passed in; the visit screen supplies `Platform.OS`, the remembered answer
 * and `PermissionsAndroid.check`.
 *
 * This decides whether to SHOW the rationale. It never requests anything: the system prompt waits
 * for "Allow the microphone" on A4 itself.
 */

export const RECORD_AUDIO = 'android.permission.RECORD_AUDIO';

export interface MicrophoneGateDeps {
  readonly isAndroid: boolean;
  /** Has A4 been answered on this phone? */
  readonly answered: () => Promise<boolean>;
  /** Is RECORD_AUDIO already granted (for example, asked inline by the voice-note screen)? */
  readonly granted: () => Promise<boolean>;
}

export const microphoneRationaleDue = async (deps: MicrophoneGateDeps): Promise<boolean> => {
  if (!deps.isAndroid) return false;
  if (await deps.answered()) return false;
  try {
    return !(await deps.granted());
  } catch {
    // The phone could not say. Not showing it is the side that cannot become a nag.
    return false;
  }
};
