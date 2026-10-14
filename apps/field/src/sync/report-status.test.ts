import { describe, expect, it, vi } from 'vitest';
import type { CreateCallReportRequest } from '@fieldforce/core';
import { callReportQueueItem, enqueueFirst, flushOutbox } from './outbox';
import type { QueuePersistence } from './outbox';
import type { OutboxWriteClient } from './push-client';
import { emptyQueue } from './reducer';
import type { SyncQueueState } from './reducer';

/**
 * `FE-W196` — a queued report reaches the server as `submitted`, including one queued by a build
 * from before the status was sent. The server's default for a report with no status is `'draft'`,
 * which no manager's approval queue lists.
 */
const inMemory = (): QueuePersistence => {
  let state: SyncQueueState = emptyQueue;
  return {
    read: () => Promise.resolve({ kind: 'loaded' as const, state }),
    write: (next) => {
      state = next;
      return Promise.resolve();
    },
  };
};

const report: CreateCallReportRequest = {
  id: '77777777-7777-4777-8777-777777777712',
  visitId: '66666666-6666-4666-8666-666666666601',
  summary: 'Discussed the dosing guide.',
  productIdsDiscussed: [],
  objectionsRaised: null,
  nextStep: null,
  status: 'submitted',
};

const sentBy = async (store: QueuePersistence): Promise<unknown> => {
  const createCallReport = vi.fn((_body: CreateCallReportRequest) => Promise.resolve({}));
  await flushOutbox({ createCallReport } as unknown as OutboxWriteClient, store);
  expect(createCallReport).toHaveBeenCalledTimes(1);
  return createCallReport.mock.calls[0]?.[0];
};

describe('a queued call report', () => {
  it('goes out as submitted', async () => {
    const store = inMemory();
    await enqueueFirst(callReportQueueItem(report), store);
    expect(await sentBy(store)).toMatchObject({ id: report.id, status: 'submitted' });
  });

  it('queued by an older build with no status, still goes out as submitted — it was always a send', async () => {
    const store = inMemory();
    const older: CreateCallReportRequest = { ...report };
    delete older.status;
    await enqueueFirst(callReportQueueItem(older), store);
    expect(await sentBy(store)).toMatchObject({ id: report.id, status: 'submitted' });
  });
});
