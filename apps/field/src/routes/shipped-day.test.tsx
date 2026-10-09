import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import DAY from './__fixtures__/day-pull.json';

/**
 * W2-D C / `BE-W158` — ONE rep's day, in the SHIPPED configuration.
 *
 * Every route test before this one replaced `usePulledStore` with a hand-written store, in the
 * mock's `+05:30` shape, with a zone the test chose. **Most of W2-B's and W2-C's device findings
 * lived exactly in that gap**: the server sends `Z` (here `+00:00`) timestamps, the zone is a server
 * answer, and the screens are joined by the real pulled store and the real queue. This test keeps
 * all of that real and replaces only what crosses the device's edge:
 *
 * | Real | Replaced, and why |
 * | --- | --- |
 * | the four route modules; `SessionProvider`, `OutboxFlusher`, `PulledStoreProvider` (the tree in `app/_layout.tsx`); the outbox, queue and reducer; storage (`@react-native-async-storage`'s own jest mock, from `jest.setup.cjs`) | **`../supabase`** — the ONE object every `rpc` goes through (`capture/client.ts`, `resolveClient`). Reads answer from `__fixtures__/day-pull.json`, CAPTURED from the real local server by `services/api/scripts/capture-day-pull.mjs`; `sync_push` records the items and answers in `SyncPushResponseSchema`'s shape |
 * | | the GPS fix (`capture/location`), audio (`expo-audio`), navigation (`expo-router`): device and native edges |
 * | | `fetch` — the visit screen's legacy REST read of consent records; answered "none", NOT captured (limit 3) |
 *
 * The clock is pinned to the capture instant, so the fixture's "today" is today. **Every visible
 * line of every screen is asserted** — not one landmark per screen — because the defects this test
 * exists for were wrong sentences on screens that otherwise rendered.
 *
 * Its limits are stated at the end of the file.
 */

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code: string; message: string } | null }>;

interface Pushed {
  readonly entity: string;
  readonly id: string;
  readonly entityId: string;
}

const mockNet = { up: true };
const mockPushed: Pushed[] = [];
const mockUnexpected: string[] = [];
const mockParams: { current: Record<string, string> } = { current: {} };

const mockRpc: Rpc = (fn, args) => {
  if (!mockNet.up) {
    // What supabase-js resolves with when `fetch` itself fails: an error with no SQLSTATE, which
    // the app reads as "no answer" (`push-client.ts`, `refusalOrSilence`; `pull.ts`).
    return Promise.resolve({
      data: null,
      error: { code: '', message: 'TypeError: Network request failed' },
    });
  }
  switch (fn) {
    case 'sync_pull': {
      const page = DAY.pages.find((p) => p.cursor === (args['p_cursor'] ?? null)) ?? DAY.pages[0];
      return Promise.resolve({ data: page?.response, error: null });
    }
    case 'my_shift_window':
      return Promise.resolve({ data: DAY.rpc.my_shift_window, error: null });
    case 'recording_permission':
      return Promise.resolve({
        data: (DAY.rpc.recording_permission as Record<string, unknown>)[String(args['p_visit_id'])],
        error: null,
      });
    case 'sync_push': {
      const items = args['p_items'] as readonly Pushed[];
      mockPushed.push(...items.map(({ entity, id, entityId }) => ({ entity, id, entityId })));
      return Promise.resolve({
        data: {
          batchId: args['p_batch_id'],
          serverTime: new Date().toISOString(),
          results: items.map((item) => ({
            id: item.id,
            status: 'accepted',
            rejectionCode: null,
            sqlState: null,
            sqlDetail: null,
            sqlHint: null,
            rejectionDetail: null,
            warnings: [],
          })),
        },
        error: null,
      });
    }
    default:
      mockUnexpected.push(`rpc ${fn}`);
      return Promise.resolve({
        data: null,
        error: { code: 'PGRST202', message: `not captured: ${fn}` },
      });
  }
};

/**
 * THE seam: `resolveClient` is where every `rpc` of every module gets its client
 * (`capture/client.ts`). Its real body is a dynamic `import('../supabase')`, which jest cannot run
 * (`offline-day.test.tsx` records why) -- so it is replaced here, with an injected client still
 * honoured exactly as the real one honours it.
 */
jest.mock('../capture/client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../capture/client'),
  resolveClient: <T,>(provided?: T): Promise<T> =>
    Promise.resolve(
      provided ?? ({ rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args) } as T),
    ),
}));

/** An UNSIGNED token carrying the captured claims: the app decodes it, nothing verifies it. */
const mockToken = (): string => {
  const claims = jest.requireActual<{ claims: Record<string, unknown> }>(
    './__fixtures__/day-pull.json',
  ).claims;
  const part = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.unsigned`;
};

jest.mock('../supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args),
    auth: {
      getSession: () =>
        Promise.resolve({
          data: {
            session: {
              access_token: mockToken(),
              user: {
                id: jest.requireActual<{ repUserId: string }>('./__fixtures__/day-pull.json')
                  .repUserId,
              },
            },
          },
          error: null,
        }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: () => Promise.resolve({ error: null }),
    },
  },
}));

// The phone's position, at the planned visit's clinic (the fixture's coordinates), stamped now.
jest.mock('../capture/location', () => ({
  takeFix: () =>
    Promise.resolve({
      kind: 'fix',
      coordinates: {
        latitude: 18.5204,
        longitude: 73.8567,
        accuracyMetres: 8,
        capturedAt: new Date().toISOString(),
      },
    }),
}));

jest.mock('expo-audio', () => ({
  AudioModule: {
    requestRecordingPermissionsAsync: () => Promise.resolve({ granted: false }),
    getRecordingPermissionsAsync: () => Promise.resolve({ granted: false }),
  },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: () => Promise.resolve(),
  useAudioRecorder: () => ({
    prepareToRecordAsync: () => Promise.resolve(),
    record: () => undefined,
    stop: () => Promise.resolve(),
    uri: null,
  }),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
}));

const mockGo: { to: (route: string) => void } = { to: () => undefined };
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: (href: string) => {
      mockGo.to(href);
    },
    replace: (href: string) => {
      mockGo.to(href);
    },
    back: () => {
      mockGo.to('back');
    },
  }),
  useLocalSearchParams: () => mockParams.current,
  Redirect: () => null,
}));

import { SessionProvider } from '../session';
import { OutboxFlusher } from '../sync/flusher';
import { PulledStoreProvider } from '../sync/pulled-store';
import Home from '../../app/(tabs)/home';
import BeatPlan from '../../app/beat-plan';
import Visit from '../../app/visit/[id]';
import Consent from '../../app/consent/[visitId]';
import Doctors from '../../app/(tabs)/doctors';

const changes = DAY.pages.flatMap((p) => p.response.changes);
// `BE-C78`: tomorrow has a plan of its own now (the seed's day-early visit is a real planned visit),
// so the pull carries TWO plans and "the first plan" is not today's. Today is the earlier date.
const today = changes
  .filter((c) => c.entity === 'beat_plan')
  .map((c) => c.payload['plan_date'] as string)
  .sort()[0] as string;
const PLANNED = changes.find(
  (c) =>
    c.entity === 'visit' && c.payload['status'] === 'planned' && c.payload['visit_day'] === today,
)?.payload['id'] as string;

const SCREENS: Record<string, () => ReactNode> = {
  home: () => <Home />,
  route: () => <BeatPlan />,
  visit: () => <Visit />,
  consent: () => <Consent />,
  doctors: () => <Doctors />,
};

const show: { screen: (name: string) => void } = { screen: () => undefined };

const App = ({ start }: { readonly start: string }): ReactNode => {
  const [name, setName] = useState(start);
  show.screen = setName;
  const Screen = SCREENS[name] ?? SCREENS['home'];
  return (
    <SessionProvider>
      <OutboxFlusher>
        <PulledStoreProvider>{Screen?.()}</PulledStoreProvider>
      </OutboxFlusher>
    </SessionProvider>
  );
};

/** Every string on screen, in order — what the rep can read. */
const visible = (): string[] => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (node.trim().length > 0) out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as { children?: unknown }).children);
  };
  walk(screen.toJSON());
  return out;
};

const launch = async (start: string): Promise<void> => {
  await cleanup();
  await render(<App start={start} />);
};

const goTo = async (name: string, params: Record<string, string> = {}): Promise<void> => {
  mockParams.current = params;
  await act(async () => {
    show.screen(name);
    await Promise.resolve();
  });
};

beforeAll(() => {
  jest.useFakeTimers({ now: new Date(DAY.capturedAt), advanceTimers: true });
  global.fetch = (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('consent')) {
      return Promise.resolve(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    mockUnexpected.push(`fetch ${url}`);
    return Promise.reject(new TypeError('Network request failed'));
  };
});

afterAll(() => {
  jest.useRealTimers();
});

/** The app's own navigation calls, followed: the rep presses, the router moves. */
const history: string[] = [];
const follow = (href: string): void => {
  const to = href === 'back' ? (history.pop(), history.at(-1) ?? '/home') : href;
  if (href !== 'back') history.push(to);
  const [, name = '', id = ''] = to.split('/');
  const screenFor: Record<string, [string, Record<string, string>]> = {
    visit: ['visit', { id }],
    consent: ['consent', { visitId: id }],
    'beat-plan': ['route', {}],
    home: ['home', {}],
    doctors: ['doctors', {}],
  };
  const [target, params] = screenFor[name] ?? ['home', {}];
  mockParams.current = params;
  show.screen(target);
};

/** The rep's clock moves as a day does: minutes between actions, not microseconds. */
const at = (minutesAfterCapture: number): void => {
  jest.setSystemTime(new Date(Date.parse(DAY.capturedAt) + minutesAfterCapture * 60_000));
};

/** Every line on the screen once `until` is showing. `DAY_PRINT=1` prints them, to regenerate. */
const lines = async (label: string, until: string | RegExp): Promise<string[]> => {
  await screen.findByText(until, {}, { timeout: 10_000 });
  const seen = visible();
  if (process.env['DAY_PRINT'] === '1') console.log(label, JSON.stringify(seen, null, 1));
  return seen;
};

const ASHA = 'Dr Asha Deshpande (DEMO)';
const REBUILT = [
  'Your list has been rebuilt',
  'This was a full refresh, so anything that was removed since you last synced has simply gone rather than being marked as removed. Everything below is what the server has for you right now.',
];
const RECORDING_ON_RECORD = [
  'The doctor agreed to a recording.',
  // 17:26 IST: +5 minutes on a capture at 11:51Z. In UTC this line would read 11:56.
  'On this phone at 17:26 · waiting to send',
  'Recording is not in this build, so nothing is being captured. The doctor’s answer is on the record either way.',
];

describe('BE-W158 — a rep’s day, shipped configuration', () => {
  it('Today, check in offline, consent, back, check out, flush, Today and the route, Doctors offline', async () => {
    mockGo.to = follow;

    // 17:21 IST. Signal. The app opens on Today, fed by the captured pull.
    at(0);
    await launch('home');
    expect(await lines('HOME', 'Next visit')).toEqual([
      'Today',
      // Dr Vikram Rao's check-in, 09:21Z — 14:51 in the territory's zone, from `my_shift_window`.
      'Started 14:51',
      ...REBUILT,
      'Next visit',
      ASHA,
      'Main clinic, Pune',
      'Scheduled 13:00',
      'Today',
      '2 of 3',
      'visits attended',
      '✓',
      'Everything sent',
      'What this app records about me',
      "See today's route",
      `Start the visit to ${ASHA}`,
    ]);

    await fireEvent.press(screen.getByText("See today's route"));
    expect(await lines('ROUTE', /planned/u)).toEqual([
      "Today's route",
      '3 planned · 2 done',
      // `BE-C78`: the day is the MANAGER's plan, which `plan_mr_day` writes approved.
      'Approved by your manager',
      'Next stop',
      ASHA,
      'Main clinic, Pune',
      'Dr Vikram Rao (DEMO)',
      '✓',
      '14:51 · 45 min',
      'Dr Meera Iyer (DEMO)',
      '✓',
      '15:51 · 40 min',
    ]);

    // No signal from here until the flush.
    mockNet.up = false;
    await goTo('visit', { id: PLANNED });
    expect(await lines('VISIT', 'I am here — check in')).toEqual([
      ASHA,
      'Main clinic, Pune',
      'Not started',
      'I am here — check in',
    ]);

    at(2);
    await fireEvent.press(screen.getByText('I am here — check in'));
    expect(await lines('CHECKED IN', /Saved on this phone/u)).toEqual([
      ASHA,
      'Main clinic, Pune',
      'Checked in — waiting to send',
      '!',
      'This check-in cannot be sent yet',
      'Saved on this phone. It will send by itself when you have signal — nothing is lost.',
      'Ask about recording',
      'Record a voice note',
      'Flag a possible side effect',
      'Record what you left',
      'Leaving — check out',
    ]);

    at(5);
    await fireEvent.press(screen.getByText('Ask about recording'));
    const consent = await lines('CONSENT', "Yes, that's fine");
    // The notice is the captured one — its label and hashes come from the server's own row.
    expect(consent).toEqual([
      'Your rep',
      'May we record this conversation?',
      'If you agree',
      'Audio is recorded until your rep stops it, kept 90 days, then deleted. Their team reviews how they presented — nothing about you is assessed, and nothing about your patients is kept.',
      "If you'd rather not",
      'Nothing is recorded and the visit carries on exactly as it would have. It counts against your rep in no way at all, and you will not be asked again today.',
      consent[6],
      consent[7],
      'Exactly what is collected, in full',
      "No, don't record",
      "Yes, that's fine",
      'Give the phone back',
    ]);
    const notice = changes.find((c) => c.entity === 'consent_text_version')?.payload;
    expect(consent[6]).toBe(notice?.['full_text']);
    expect(consent[7]).toMatch(/^Notice DEMO v1 .+ · English · [0-9a-f]{8}$/u);

    await fireEvent.press(screen.getByText("Yes, that's fine"));
    expect(await lines('BACK', 'Leaving — check out')).toEqual([
      ASHA,
      'Main clinic, Pune',
      'Checked in — waiting to send',
      ...RECORDING_ON_RECORD,
      'Record a voice note',
      'Flag a possible side effect',
      'Record what you left',
      'Leaving — check out',
    ]);

    at(20);
    await fireEvent.press(screen.getByText('Leaving — check out'));
    expect(await lines('CHECKED OUT', 'Visit finished — waiting to send')).toEqual([
      ASHA,
      'Main clinic, Pune',
      'Visit finished — waiting to send',
      ...RECORDING_ON_RECORD,
      '!',
      'This check-out cannot be sent yet',
      'Saved on this phone. It will send by itself when you have signal — nothing is lost.',
      'Record a voice note',
      'Flag a possible side effect',
      'Write your report',
    ]);

    await goTo('home');
    const finishedToday = [
      'Today',
      'Started 14:51',
      ...REBUILT,
      "That's everyone on the plan",
      'You went to every visit on the plan.',
      'Today',
      '3 of 3',
      'visits attended',
    ];
    expect(await lines('HOME OFFLINE', /waiting · no signal/u)).toEqual([
      ...finishedToday,
      '3 waiting · no signal',
      'What this app records about me',
      'How today ended',
    ]);

    await goTo('route');
    const routeFinished = [
      "Today's route",
      '3 planned · 3 done',
      'Approved by your manager',
      ASHA,
      '✓',
      // `BE-W165`, FIXED W2-E D. This line read "Not started" (marked UNTRUE) for a visit checked in
      // at 17:23 and out at 17:41 on this phone. Now the phone's own times, SAID to be the phone's —
      // the server's row still has no start until a pull returns one.
      '17:23 on this phone · 18 min',
      'Dr Vikram Rao (DEMO)',
      '✓',
      '14:51 · 45 min',
      'Dr Meera Iyer (DEMO)',
      '✓',
      '15:51 · 40 min',
    ];
    expect(await lines('ROUTE OFFLINE', /planned/u)).toEqual(routeFinished);
    expect(mockPushed).toEqual([]);

    // 17:51. Signal again; the app comes back and the outbox flushes — in the order the work was done.
    at(30);
    mockNet.up = true;
    await launch('home');
    await waitFor(
      () => {
        expect(mockPushed).toHaveLength(3);
      },
      { timeout: 10_000 },
    );
    expect(mockPushed.map((p) => [p.entity, p.entityId])).toEqual([
      ['check_in', PLANNED],
      ['consent_record', PLANNED],
      ['check_out', PLANNED],
    ]);
    expect(new Set(mockPushed.map((p) => p.id)).size).toBe(3);
    expect(await lines('HOME FLUSHED', 'Everything sent')).toEqual([
      ...finishedToday,
      '✓',
      'Everything sent',
      '17:51',
      'What this app records about me',
      'How today ended',
    ]);
    await goTo('route');
    // Unchanged after the flush: this fake server does not apply pushes to later pulls (limit 2).
    expect(await lines('ROUTE FLUSHED', /planned/u)).toEqual(routeFinished);

    // 18:01. No signal; the Doctors tab opens from what the phone holds.
    at(40);
    mockNet.up = false;
    await launch('doctors');
    expect(await lines('DOCTORS OFFLINE', /Dr Asha/u)).toEqual([
      'Doctors',
      'Name, clinic or area',
      'All',
      'Not seen 30d',
      'On plan',
      'Dr Meera Iyer (DEMO)',
      '✓',
      'Urology · Pune · today',
      'Dr Vikram Rao (DEMO)',
      '✓',
      'Nephrology · Pune · today',
      // `BE-W165`, FIXED W2-E D. Read "yesterday" (marked UNTRUE), and so was FIRST — the list puts
      // the longest-unseen doctor first. Seen today at 17:41 on this phone, the most recent of the
      // three, so now last, and said so.
      ASHA,
      '✓',
      'Urology · Pune · today',
      '3 doctors in your territory.',
    ]);

    // Nothing reached for that this test does not answer from the capture.
    expect(mockUnexpected).toEqual([]);
  });
});

/**
 * C5 — WHAT THIS TEST DOES NOT ESTABLISH.
 *
 * 1. **The server's verdicts.** `sync_push` is faked at the RPC boundary and accepts everything: the
 *    geofence, the shift window, the consent rules and duplicate handling are the database's, and
 *    are proved in `services/api/tests`, not here. A refusal path is not driven.
 * 2. **A server that changes.** Later pulls replay the capture; pushes are not applied to them. So
 *    "after the flush, the next pull heals the route" is NOT shown — so the phone's own times
 *    (`BE-W165`, fixed W2-E D, "on this phone") are what the route shows for the rest of the day here,
 *    where on a device a pull after the flush replaces them with the server's.
 * 3. **One read is not captured**: the visit screen's legacy REST read of consent records is answered
 *    "none" by a stub `fetch`.
 * 4. **Device edges**: the GPS fix is a fixed coordinate at the clinic; audio is off; navigation is a
 *    stand-in that follows the app's own `push`/`replace`/`back` calls — no real `expo-router` stack,
 *    no back gesture, no tab bar. AsyncStorage is the library's jest mock (in memory, same API).
 * 5. **Process death** is not driven here (`offline-day.test.tsx` does that); "signal again" is a
 *    relaunch, not a foreground event (`OutboxFlusher` also flushes on `AppState` → active).
 * 6. **The fixture is one day's shape**: one tenant, three doctors, a plan already in progress, a
 *    single page, `Asia/Kolkata`. A zone with a different offset, a multi-page pull or a deletion
 *    are not in it. Yesterday's visit started at the same 14:51 as today's first one (the seed
 *    uses the same hours), so "Started 14:51" alone cannot tell them apart; the route's two
 *    ticked times can.
 * 7. **It is not a device.** Rendering is react-test-renderer: layout, clipping, fonts and the
 *    keyboard are not seen. W2-B's emulator findings of that kind would not be caught here.
 */
