import { t } from '@fieldforce/ui/i18n';

/**
 * `FE-W127` — what the lesson video says, decided without a renderer (tested in
 * `lesson-video-view.test.ts`). Every line is true of what happened: a clip that needs signal says
 * so; a clip the server would not hand over says it did not load. Neither is an alarm — the lesson's
 * text is all there either way.
 *
 * `FE-W183`. Each line is read from the catalogue when it is asked for, in the app's language.
 */

/** `754` → `"12:34"`, `3723` → `"1:02:03"`. */
export const clock = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${String(h)}:${two(m)}:${two(s)}` : `${String(m)}:${two(s)}`;
};

/** The line under the player: "Video · 12:34", or "Video" when the length was not measured. */
export const videoLengthLabel = (durationSeconds: number | null): string =>
  durationSeconds === null
    ? t('learning.video')
    : t('learning.videoLength', { length: clock(durationSeconds) });

/** What a screen reader hears on the poster. */
export const playLabel = (durationSeconds: number | null): string =>
  durationSeconds === null
    ? t('learning.playVideo')
    : t('learning.playVideoLength', { length: clock(durationSeconds) });

/** Why the video is not playing, in the rep's words. Neutral: the text below still reads. */
export const videoFailureLine = (kind: 'offline' | 'error'): string =>
  kind === 'offline' ? t('learning.videoOffline') : t('learning.videoError');
