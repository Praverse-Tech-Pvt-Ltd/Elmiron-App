import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SyncQueueItemSchema } from '@fieldforce/core';
import { QueueScreen } from '@fieldforce/ui';
import { presentRejection } from '../sync/explanation';
import { emptyQueue, syncQueueReducer } from '../sync/reducer';
import type { SyncEvent } from '../sync/events';
import type { SyncQueueState } from '../sync/reducer';

// The route now reads the outbox off disk and can retry it, so it pulls in the API
// client — whose module validates EXPO_PUBLIC_* at load and throws under jest.
// Mocked at the same boundary the other route tests use.
jest.mock('../api', () => ({ createClientForScenario: () => ({}) }));
// MR-28 C2. The retry path, so a flush that REJECTS can be driven. `createPushClient`
// reaches the config too, and `flushOutbox` is the thing under test rather than the thing
// being stubbed out.
const mockFlush = jest.fn<() => Promise<unknown>>();
jest.mock('../sync/outbox', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/outbox'),
  flushOutbox: () => mockFlush(),
}));
jest.mock('../sync/push-client', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({}),
}));
// "Try again now" is rendered only when something is actually stuck -- `QueueScreen` says
// so: *"a button that does nothing on the screen reporting a failure is the cruellest
// possible place for one."* So the route has to be handed a queue with a stuck row, and
// that comes off disk.
const mockLoadQueueState = jest.fn<() => Promise<unknown>>(async () => Promise.resolve(emptyQueue));
jest.mock('../sync/async-storage-store', () => ({
  ...jest.requireActual<Record<string, unknown>>('../sync/async-storage-store'),
  loadQueueState: () => mockLoadQueueState(),
}));

import Queue from '../../app/queue';

/**
 * The chain, end to end: contract-parsed input -> the real reducer -> the screen.
 *
 * Every link is validated. The item is parsed by `@fieldforce/core`'s schema, so a
 * drift throws rather than merely differing. The state is produced by the actual
 * reducer rather than assembled by hand, so the screen is fed exactly what the app
 * will feed it. Nothing between them is a fixture.
 */
const parsed = SyncQueueItemSchema.parse({
  id: '15151515-1515-4515-8515-151515151501',
  entity: 'check_in',
  operation: 'create',
  entityId: '15151515-1515-4515-8515-1515151515aa',
  payload: {},
  status: 'queued',
  attemptCount: 0,
  lastError: null,
  clientCreatedAt: '2026-08-17T09:00:00.000Z',
  syncedAt: null,
});

describe('app/queue.tsx — the binding', () => {
  it('renders the empty state, which is the honest state today', async () => {
    // Nothing enqueues until FE-W3 and there is no store, so the queue really is
    // empty. A binding that faked a populated one would be a screen that lies.
    await render(<Queue />);
    expect(screen.getByText('Everything is sent')).toBeTruthy();
  });
});

describe('contract -> reducer -> screen', () => {
  it('shows a refusal the reducer produced from a real server verdict', async () => {
    const events: SyncEvent[] = [
      { type: 'enqueued', item: parsed },
      {
        type: 'verdict_received',
        verdict: {
          id: parsed.id,
          status: 'rejected',
          rejectionCode: 'outside_geofence',
          sqlState: null,
          explanation: 'You were not close enough to the clinic when this was recorded.',
          warnings: [],
          attemptsRemaining: 2,
          receivedAt: '2026-08-17T11:22:33.000Z',
        },
      },
    ];
    const state = events.reduce(syncQueueReducer, emptyQueue);

    await render(
      <QueueScreen
        items={state.items}
        rejections={Object.fromEntries(
          Object.entries(state.rejections).map(([id, r]) => [id, presentRejection(r)]),
        )}
      />,
    );

    expect(screen.getByText('Refused')).toBeTruthy();
    expect(
      screen.getByText('You were not close enough to the clinic when this was recorded.'),
    ).toBeTruthy();
  });

  it('shows a long wait the reducer produced from repeated transport failures', async () => {
    // Five failed pushes, no verdict. The server has decided nothing, so the screen
    // must say "still trying" and must not say "refused".
    let state = syncQueueReducer(emptyQueue, { type: 'enqueued', item: parsed });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      state = syncQueueReducer(state, { type: 'batch_started', ids: [parsed.id] });
      state = syncQueueReducer(state, {
        type: 'attempt_failed',
        ids: [parsed.id],
        error: 'offline',
      });
    }

    await render(
      <QueueScreen
        items={state.items}
        rejections={Object.fromEntries(
          Object.entries(state.rejections).map(([id, r]) => [id, presentRejection(r)]),
        )}
      />,
    );

    expect(screen.getByText('Still trying')).toBeTruthy();
    expect(screen.queryByText('Refused')).toBeNull();
  });
});

/** A queue with one row the server has refused, which is what puts the button on screen. */
const stuck = (): SyncQueueState =>
  (
    [
      { type: 'enqueued', item: parsed },
      {
        type: 'verdict_received',
        verdict: {
          id: parsed.id,
          // DEAD-LETTERED, not merely rejected. `stuckSummaryFor` counts only
          // `waiting-long` and `needs-attention`, and `QueueScreen` renders the retry
          // button only inside that block -- *"a button that does nothing on the screen
          // reporting a failure is the cruellest possible place for one."* A plain refusal
          // would leave nothing to press and this case would pass on an absent button.
          status: 'dead_lettered',
          rejectionCode: 'outside_geofence',
          sqlState: null,
          explanation: 'You were not close enough to the clinic when this was recorded.',
          warnings: [],
          attemptsRemaining: 0,
          receivedAt: '2026-08-17T11:22:33.000Z',
        },
      },
    ] as readonly SyncEvent[]
  ).reduce(syncQueueReducer, emptyQueue);

describe('MR-28 C2 — "Try again now" is never a silent tap', () => {
  it('SAYS SO when the flush itself could not run', async () => {
    // The route had `void flushOutbox(...).then(refresh)` and no `.catch`. `flushOutbox`
    // handles each ITEM's verdict, but the flush can still reject -- the queue could not
    // be read or written, or `createPushClient` threw reaching the config. When it did,
    // `refresh` never ran, no row moved, and the MR had just pressed the one button on the
    // screen that exists to explain why things are stuck.
    //
    // A silent tap is worse HERE than anywhere else in the app: this is where somebody
    // goes when they already suspect something is wrong.
    mockLoadQueueState.mockResolvedValue(stuck());
    mockFlush.mockRejectedValue(new Error('The queue on this phone could not be read.'));
    await render(<Queue />);
    await screen.findByText('Try again now');

    await fireEvent.press(screen.getByText('Try again now'));

    expect(await screen.findByText('Nothing could be sent')).toBeTruthy();
    // And the sentence tells them the work is safe, which is the part that decides whether
    // they try again or start retyping.
    expect(screen.getByText(/still on this phone/u)).toBeTruthy();
    expect(screen.getByText(/could not be read/u)).toBeTruthy();
  });

  it('THE POSITIVE CONTROL: says nothing when the flush worked', async () => {
    // Without this, a banner rendered unconditionally would satisfy the case above while
    // telling every MR their queue is broken.
    mockLoadQueueState.mockResolvedValue(stuck());
    mockFlush.mockResolvedValue({ attempted: 0, sent: 0, failed: 0 });
    await render(<Queue />);
    await screen.findByText('Try again now');

    await fireEvent.press(screen.getByText('Try again now'));

    await waitFor(() => {
      expect(mockFlush).toHaveBeenCalled();
    });
    expect(screen.queryByText('Nothing could be sent')).toBeNull();
  });
});
