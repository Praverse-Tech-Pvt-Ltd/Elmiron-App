import { describe, expect, it } from 'vitest';
import { clock, playLabel, videoFailureLine, videoLengthLabel } from './lesson-video-view';

describe('lesson video words (FE-W127)', () => {
  it('a length reads as a clock, and an unmeasured one is not invented', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(59.6)).toBe('1:00');
    expect(clock(754)).toBe('12:34');
    expect(clock(3723)).toBe('1:02:03');
    expect(videoLengthLabel(754)).toBe('Video · 12:34');
    expect(videoLengthLabel(null)).toBe('Video');
    expect(playLabel(90)).toBe('Play the lesson video, 1:30 long');
    expect(playLabel(null)).toBe('Play the lesson video');
  });

  it('no signal and a refusal say different, true things, and both keep the text', () => {
    const offline = videoFailureLine('offline');
    const error = videoFailureLine('error');
    expect(offline).toMatch(/needs a connection/u);
    expect(error).toMatch(/did not load/u);
    for (const line of [offline, error]) expect(line).toMatch(/text below is all here/u);
    expect(offline).not.toBe(error);
  });
});
