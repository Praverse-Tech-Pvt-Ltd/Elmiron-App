/**
 * FE-D16 — the build's consultation-recording switch, for the Coaching feed.
 *
 * `../config` is imported on use, as `recording-permission.ts` and the transparency screen do: it
 * throws at import on a misconfigured build, and **a flag that cannot be read is OFF**. Coaching
 * needs it because an analysis is made from a recorded consultation, so with recording off the
 * feed can never fill, and it says so.
 */
export const loadRecordingEnabled = (): Promise<boolean> =>
  import('../config').then(
    ({ appConfig }) => appConfig.recordingEnabled,
    () => false,
  );
