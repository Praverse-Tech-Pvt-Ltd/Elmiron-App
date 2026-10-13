import { describe, expect, it } from 'vitest';
import type { LiveTrackingStatus } from '@fieldforce/core';
import { TRACKING_WORDS } from '../integrations/tracking';
import { LiveRequestError } from '../live-rest';
import { dayIsOpen, dueToSend, refreshAfter, stateOf, trackingLine } from './decide';
import { createLiveTrackingBackend } from './live';

/**
 * `FE-W71` — the tracker's decisions and its transport. The rules themselves are the server's
 * (`services/api/tests/live-tracking.spec.ts`); these prove the phone obeys `trackingState` with the
 * server's inputs, and never fills a missing answer with "on".
 */
const NOTICE = '4e86b49c-05fc-4bd8-9f75-16e22a64309a';

const on: LiveTrackingStatus = {
  companyEnabled: true,
  intervalSeconds: 300,
  notice: { id: NOTICE, versionLabel: 'DRAFT', body: 'text', isDraft: true },
  accepted: true,
  acceptedNoticeVersionId: NOTICE,
  withinWorkingHours: true,
  shiftEnd: '18:00:00',
  timeZone: 'Asia/Kolkata',
  today: '2026-10-13',
  serverTime: '2026-10-13T05:38:23+00:00',
};
const opened = { foreground: true, openedDay: '2026-10-13' };

describe('live tracking — the state, from the server and the phone', () => {
  it('POSITIVE CONTROL: everything on, today opened, on screen -- active', () => {
    expect(stateOf(on, opened)).toBe('active');
  });

  it('no answer from the server is off, never on', () => {
    expect(stateOf(null, opened)).toBe('off_company');
  });

  it.each([
    { label: 'the company switch', change: { companyEnabled: false }, state: 'off_company' },
    { label: 'the acceptance', change: { accepted: false }, state: 'off_no_notice' },
    { label: 'the hours', change: { withinWorkingHours: false }, state: 'paused_outside_hours' },
  ])('the server turning off $label stops it: $state', ({ change, state }) => {
    expect(stateOf({ ...on, ...change }, opened)).toBe(state);
  });

  it('a day opened YESTERDAY is not open today: it never resumes by itself', () => {
    expect(dayIsOpen(on, '2026-10-12')).toBe(false);
    expect(stateOf(on, { foreground: true, openedDay: '2026-10-12' })).toBe('paused_day_closed');
    expect(stateOf(on, { foreground: true, openedDay: null })).toBe('paused_day_closed');
  });

  it('the app off screen pauses it', () => {
    expect(stateOf(on, { ...opened, foreground: false })).toBe('paused_background');
  });
});

describe('live tracking — cadence and verdicts', () => {
  it('sends the first fix, then one per interval (with a little slack)', () => {
    expect(dueToSend(null, 0, 300)).toBe(true);
    expect(dueToSend(0, 200_000, 300)).toBe(false);
    expect(dueToSend(0, 295_000, 300)).toBe(true);
  });

  it('asks the server again after a refusal that means the picture is stale, and only then', () => {
    const verdict = { stored: false, replayed: false, receivedAt: null };
    expect(refreshAfter({ ...verdict, reason: 'company_off' })).toBe(true);
    expect(refreshAfter({ ...verdict, reason: 'no_acceptance' })).toBe(true);
    expect(refreshAfter({ ...verdict, reason: 'outside_working_hours' })).toBe(true);
    expect(refreshAfter({ ...verdict, reason: 'too_frequent' })).toBe(false);
    expect(
      refreshAfter({ stored: true, replayed: false, reason: null, receivedAt: on.serverTime }),
    ).toBe(false);
  });
});

describe('live tracking — never silent', () => {
  const base = { status: on, loadFailed: false, permissionDenied: false, lastSend: null };

  it('every state has a line, in TRACKING_WORDS', () => {
    for (const state of Object.keys(TRACKING_WORDS) as (keyof typeof TRACKING_WORDS)[]) {
      expect(trackingLine({ ...base, state }).title).toContain(TRACKING_WORDS[state]);
    }
  });

  it('active says until when, by the server window', () => {
    expect(trackingLine({ ...base, state: 'active' }).title).toContain('Until 18:00.');
  });

  it('says so when a position did not reach the company, or was refused', () => {
    expect(trackingLine({ ...base, state: 'active', lastSend: { kind: 'failed' } }).detail).toMatch(
      /did not reach/,
    );
    expect(
      trackingLine({
        ...base,
        state: 'active',
        lastSend: { kind: 'refused', reason: 'recorded_in_future' },
      }).detail,
    ).toMatch(/clock/);
  });

  it('a changed notice is named, not just "off"', () => {
    const changed = { ...on, accepted: false, acceptedNoticeVersionId: NOTICE };
    expect(trackingLine({ ...base, status: changed, state: 'off_no_notice' }).detail).toMatch(
      /changed/,
    );
  });

  it('active without the permission says it cannot run', () => {
    expect(trackingLine({ ...base, state: 'active', permissionDenied: true }).title).toMatch(
      /cannot run/,
    );
  });

  it('before the server answers, and when it cannot be asked', () => {
    expect(trackingLine({ ...base, status: null, state: 'off_company' }).title).toMatch(/Checking/);
    expect(
      trackingLine({ ...base, status: null, loadFailed: true, state: 'off_company' }).title,
    ).toMatch(/could not ask/);
  });
});

describe('live tracking — the transport', () => {
  const connection = (respond: (fn: string, body: unknown) => Response, calls: string[] = []) => ({
    baseUrl: 'http://server.test',
    apiKey: 'k',
    accessToken: () => Promise.resolve('t'),
    fetch: ((url: string, init: { body: string }) => {
      const fn = url.split('/rpc/')[1] ?? '';
      calls.push(`${fn} ${init.body}`);
      return Promise.resolve(respond(fn, JSON.parse(init.body)));
    }) as unknown as typeof fetch,
  });

  it('sends a position with its own id and the device time, and parses the verdict', async () => {
    const calls: string[] = [];
    const backend = createLiveTrackingBackend(
      connection(
        () =>
          new Response(
            JSON.stringify({
              stored: true,
              replayed: false,
              reason: null,
              receivedAt: on.serverTime,
            }),
          ),
        calls,
      ),
    );
    const verdict = await backend.ping({
      id: NOTICE,
      latitude: 18.5,
      longitude: 73.8,
      accuracyM: null,
      recordedAt: '2026-10-13T05:38:20.000Z',
    });
    expect(verdict.stored).toBe(true);
    expect(calls[0]).toBe(
      `record_location_ping ${JSON.stringify({
        p_id: NOTICE,
        p_latitude: 18.5,
        p_longitude: 73.8,
        p_accuracy_m: null,
        p_recorded_at: '2026-10-13T05:38:20.000Z',
      })}`,
    );
  });

  it('accepts the version it was shown, and surfaces 45001 with its code', async () => {
    const backend = createLiveTrackingBackend(
      connection(
        () =>
          new Response(
            JSON.stringify({ code: '45001', message: 'live_tracking_notice_superseded' }),
            {
              status: 400,
            },
          ),
      ),
    );
    const refused = await backend.accept(NOTICE).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(LiveRequestError);
    expect((refused as LiveRequestError).code).toBe('45001');
  });

  it('a status the contract does not describe is a failure, not a guess', async () => {
    const backend = createLiveTrackingBackend(
      connection(() => new Response(JSON.stringify({ companyEnabled: 'yes' }))),
    );
    await expect(backend.status()).rejects.toThrow();
  });
});
