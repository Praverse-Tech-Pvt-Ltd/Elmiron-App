import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as content from './content';
import { NEVER_RECORDED, TRANSPARENCY_ENTRIES, transparencyEntries } from './content';

/**
 * **FE-D12 item 1. A9 must say what this build records, and nothing it does not.**
 *
 * FE-D12's walkthrough found A9 saying "Right now this app records nothing new about you", with
 * check-ins, location and voice notes each marked "Not yet — this app cannot do this today". Every
 * one of those was being recorded: a rep who read the one screen whose job is to not overstate
 * was told the opposite of the truth.
 *
 * The rows were right when written (FE-W3) and went stale as each capture landed, because
 * nothing tied them to the code. This test ties them. "Active in this build" is decided by
 * reading the routes that do the capturing -- the same evidence the A9 citations point at --
 * so a row that says "Not yet" about a wired capture fails here, and so does one that claims a
 * capture nothing performs.
 */
const APP_ROOT = join(__dirname, '..', '..');
const source = (path: string): string => readFileSync(join(APP_ROOT, path), 'utf8');

const WIRED = {
  // `takeFix` is called on the visit screen's check-in/check-out press, and nowhere else.
  location: source('app/visit/[id].tsx').includes('await takeFix()'),
  visitTimes:
    source('app/visit/[id].tsx').includes('client.createCheckIn(body)') &&
    source('app/visit/[id].tsx').includes('client.createCheckOut(body)'),
  voiceNotes: source('app/voice-note/[visitId].tsx').includes('.uploadVoiceNote(body)'),
  reports:
    source('app/report/[visitId].tsx').includes('.createCallReport(body)') &&
    source('app/samples/[visitId].tsx').includes('client.createSampleAndInput(body)'),
} as const;

/** Which row speaks for which capture, found by its title so a rename cannot hide a row. */
const rowFor = (pattern: RegExp) => {
  const row = TRANSPARENCY_ENTRIES.find((entry) => pattern.test(entry.title));
  if (row === undefined) throw new Error(`A9 has no row matching ${String(pattern)}`);
  return row;
};

describe('A9 — what this build records (FE-D12 item 1)', () => {
  it('the captures this test relies on really are wired (a guard on the guard)', () => {
    expect(WIRED).toEqual({ location: true, visitTimes: true, voiceNotes: true, reports: true });
  });

  it.each([
    ['location', /where you (are|were)/i],
    ['visitTimes', /which doctors/i],
    ['voiceNotes', /voice notes/i],
    ['reports', /report/i],
  ] as const)('does not call %s "not yet" while it is recorded', (feature, pattern) => {
    expect(WIRED[feature]).toBe(true);
    expect(rowFor(pattern).state).toBe('active');
  });

  it('does not tell the rep that nothing is recorded', () => {
    // The old preamble said exactly this. Whatever this module exports as text, none of it may.
    const all = [
      ...(Object.values(content) as unknown[]).filter(
        (value): value is string => typeof value === 'string',
      ),
      ...TRANSPARENCY_ENTRIES.map((e) => `${e.title} ${e.detail}`),
    ];
    for (const line of all) {
      expect(line).not.toMatch(/records nothing|when those parts are built/i);
    }
  });

  it('describes location as a press, never as tracking through the shift', () => {
    const location = rowFor(/where you (are|were)/i);
    expect(`${location.title} ${location.detail}`).toMatch(/check in or check out/i);
    expect(location.detail).not.toMatch(/start day to end day|during your shift/i);
  });

  it('does not promise deletion it cannot show: voice notes are MARKED for deletion at 90 days', () => {
    // `stamp_audio_retention` sets `purge_after = received_at + 90 days` on every voice note
    // (20260815000300_audio_consent_retention.sql:196-209). That is the claim the code backs.
    expect(rowFor(/voice notes/i).detail).toMatch(/marked for deletion 90 days/i);
  });

  it('never names a permission this app does not hold', () => {
    // The APK holds no camera, contacts, SMS or call-log permission (aapt2 dump, FE-D12), so it
    // may say it cannot reach them. It holds RECORD_AUDIO, so "never the microphone" would be false.
    expect(NEVER_RECORDED).not.toMatch(/microphone/i);
  });
});

describe('A9 — consultation recording follows the build flag (FE-D12 item 1)', () => {
  const recording = (enabled: boolean) => {
    const row = transparencyEntries({ recordingEnabled: enabled }).find((e) =>
      /recordings/i.test(e.title),
    );
    if (row === undefined) throw new Error('A9 has no recordings row');
    return row;
  };

  it('is "not yet" while recording is off, which it is in this build', () => {
    expect(recording(false).state).toBe('not-yet');
  });

  it('is active when the build switches recording on', () => {
    expect(recording(true).state).toBe('active');
  });

  it('the default export is the recording-off build', () => {
    expect(TRANSPARENCY_ENTRIES).toEqual(transparencyEntries({ recordingEnabled: false }));
  });
});
