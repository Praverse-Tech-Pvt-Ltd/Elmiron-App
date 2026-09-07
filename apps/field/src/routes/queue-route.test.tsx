import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { SyncQueueItemSchema } from '@fieldforce/core';
import { QueueScreen } from '@fieldforce/ui';
import { emptyQueue, syncQueueReducer } from '../sync/reducer';
import type { SyncEvent } from '../sync/events';

// The route now reads the outbox off disk and can retry it, so it pulls in the API
// client — whose module validates EXPO_PUBLIC_* at load and throws under jest.
// Mocked at the same boundary the other route tests use.
jest.mock('../api', () => ({ createClientForScenario: () => ({}) }));

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
          explanation: 'You were not close enough to the clinic when this was recorded.',
          warnings: [],
          attemptsRemaining: 2,
          receivedAt: '2026-08-17T11:22:33.000Z',
        },
      },
    ];
    const state = events.reduce(syncQueueReducer, emptyQueue);

    await render(<QueueScreen items={state.items} rejections={state.rejections} />);

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

    await render(<QueueScreen items={state.items} rejections={state.rejections} />);

    expect(screen.getByText('Still trying')).toBeTruthy();
    expect(screen.queryByText('Refused')).toBeNull();
  });
});
