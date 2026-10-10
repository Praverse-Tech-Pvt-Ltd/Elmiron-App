import { describe, expect, it } from 'vitest';
import { noKeyMaps } from './maps';
import {
  DEFAULT_PREFERENCES,
  createMockNotificationAdapter,
  deepLinkFor,
  shouldShow,
} from './notifications';
import { trackingState, TRACKING_WORDS } from './tracking';
import type { TrackingInputs } from './tracking';
import {
  TYPE_INSTEAD,
  silentTextToSpeech,
  transcriptOrFallback,
  unavailableSpeechToText,
} from './voice';

describe('maps — no key', () => {
  it('directions open the phone’s own maps app at the clinic', () => {
    expect(
      noKeyMaps.directionsLink({
        latitude: 18.5204,
        longitude: 73.8567,
        label: 'Main clinic, Pune',
      }),
    ).toBe('geo:18.5204,73.8567?q=18.5204,73.8567(Main%20clinic%2C%20Pune)');
    expect(noKeyMaps.embedsMap).toBe(false);
  });

  it('no coordinates, or impossible ones: no link, rather than a wrong place', () => {
    expect(noKeyMaps.directionsLink(null)).toBeNull();
    expect(noKeyMaps.directionsLink({ latitude: 95, longitude: 0, label: 'x' })).toBeNull();
    expect(noKeyMaps.directionsLink({ latitude: Number.NaN, longitude: 0, label: 'x' })).toBeNull();
  });
});

describe('notifications — event model, preferences, deep links, mock adapter', () => {
  it('every one of the four types is on by default', () => {
    expect(Object.keys(DEFAULT_PREFERENCES).sort()).toEqual(
      ['coaching', 'consent-outcome', 'day-plan', 'sync-outcome'].sort(),
    );
    expect(Object.values(DEFAULT_PREFERENCES).every(Boolean)).toBe(true);
  });

  it('each event opens its own screen inside the app', () => {
    expect(deepLinkFor({ type: 'day-plan', planDate: '2026-10-10' })).toBe('/beat-plan');
    expect(deepLinkFor({ type: 'sync-outcome', itemId: 'i', refused: true })).toBe('/queue');
    expect(deepLinkFor({ type: 'consent-outcome', visitId: 'v1' })).toBe('/visit/v1');
    expect(deepLinkFor({ type: 'coaching', analysisId: 'a1' })).toBe('/analysis/a1');
  });

  it('a type the rep turned off, or the day’s cap reached, is not shown', () => {
    const event = { type: 'coaching', analysisId: 'a1' } as const;
    expect(shouldShow(event, DEFAULT_PREFERENCES, 0, 4)).toBe(true);
    expect(shouldShow(event, { ...DEFAULT_PREFERENCES, coaching: false }, 0, 4)).toBe(false);
    expect(shouldShow(event, DEFAULT_PREFERENCES, 4, 4)).toBe(false);
  });

  it('the mock adapter records what would have been shown, with its link', async () => {
    const adapter = createMockNotificationAdapter();
    await adapter.show('Your day is ready', { type: 'day-plan', planDate: '2026-10-10' });
    expect(adapter.shown).toEqual([{ title: 'Your day is ready', link: '/beat-plan' }]);
  });
});

describe('voice — interfaces and the text fallback', () => {
  it('with no provider, nothing is transcribed and the screen offers typing', async () => {
    const result = await unavailableSpeechToText.transcribe('file:///note.m4a');
    expect(transcriptOrFallback(result)).toEqual({ text: '', fallback: TYPE_INSTEAD });
    expect(await silentTextToSpeech.speak('hello')).toBe(false);
  });

  it('a real transcript is used; an empty one is treated as none', () => {
    expect(transcriptOrFallback({ kind: 'text', text: ' Discussed dosing. ' })).toEqual({
      text: 'Discussed dosing.',
      fallback: null,
    });
    expect(transcriptOrFallback({ kind: 'text', text: '  ' }).fallback).toBe(TYPE_INSTEAD);
  });
});

describe('live tracking — whether, never how', () => {
  const on: TrackingInputs = {
    companyEnabled: true,
    noticeAccepted: true,
    withinWorkingHours: true,
    foreground: true,
    dayOpen: true,
  };

  it('active only when every condition holds', () => {
    expect(trackingState(on)).toBe('active');
  });

  it('each missing condition names itself, in order of precedence', () => {
    expect(trackingState({ ...on, companyEnabled: false, noticeAccepted: false })).toBe(
      'off_company',
    );
    expect(trackingState({ ...on, noticeAccepted: false })).toBe('off_no_notice');
    expect(trackingState({ ...on, withinWorkingHours: false })).toBe('paused_outside_hours');
    expect(trackingState({ ...on, dayOpen: false })).toBe('paused_day_closed');
    expect(trackingState({ ...on, foreground: false })).toBe('paused_background');
  });

  it('the rep is told every state — tracking is never silent', () => {
    for (const words of Object.values(TRACKING_WORDS)) expect(words.length).toBeGreaterThan(10);
  });
});
