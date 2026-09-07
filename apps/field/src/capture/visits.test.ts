import { describe, expect, it } from 'vitest';
import { createVisit, listMileage, updateVisit } from './visits';
import type { RpcCaller, TableWriter } from './client';

/**
 * FE-W16's unblocked half, client side. The round trip against a real database lives in
 * `services/api/tests/write-path.spec.ts`.
 */

const VISIT_ROW = {
  id: '55555555-5555-4555-8555-555555555555',
  mr_id: '33333333-3333-4333-8333-333333333333',
  doctor_id: '44444444-4444-4444-8444-444444444444',
  beat_plan_id: null,
  clinic_address_id: null,
  status: 'planned',
  scheduled_for: null,
  started_at: null,
  completed_at: null,
  created_at: '2026-09-07T17:58:27+05:30',
  updated_at: '2026-09-07T17:58:27+05:30',
  received_at: '2026-09-07T17:58:27+05:30',
};

type Result = { data: unknown; error: { code?: string | null; message: string } | null };

/** Captures what was actually sent, so the test can assert on the payload. */
const writer = (result: Result) => {
  const sent: Record<string, unknown>[] = [];
  const leaf = { select: () => ({ single: () => Promise.resolve(result) }) };
  const client: TableWriter = {
    from: () => ({
      insert: (values: Record<string, unknown>) => {
        sent.push(values);
        return leaf;
      },
      update: (values: Record<string, unknown>) => {
        sent.push(values);
        return { eq: () => leaf };
      },
    }),
  };
  return { client, sent };
};

const rpc = (result: Result): RpcCaller => ({ rpc: () => Promise.resolve(result) });

describe('createVisit', () => {
  it('never sends mr_id — the server decides who the caller is', async () => {
    // The insert policy requires mr_id = auth.uid() and the column defaults to it. A
    // client that sent the field could send someone else's; one that cannot send it
    // cannot express the wrong answer at all.
    const { client, sent } = writer({ data: VISIT_ROW, error: null });
    await createVisit({ id: VISIT_ROW.id, doctorId: VISIT_ROW.doctor_id }, client);
    expect(Object.keys(sent[0] ?? {})).not.toContain('mr_id');
    expect(sent[0]).toMatchObject({ id: VISIT_ROW.id, doctor_id: VISIT_ROW.doctor_id });
  });

  it('maps the returned row into the contract entity', async () => {
    const { client } = writer({ data: VISIT_ROW, error: null });
    const outcome = await createVisit({ id: VISIT_ROW.id, doctorId: VISIT_ROW.doctor_id }, client);
    if (outcome.kind !== 'saved') throw new Error('expected a saved visit');
    expect(outcome.visit.mrId).toBe(VISIT_ROW.mr_id);
    expect(outcome.visit.beatPlanId).toBeNull();
    expect(outcome.visit.status).toBe('planned');
  });

  it('reports a refusal as a refusal', async () => {
    const { client } = writer({ data: null, error: { code: '42501', message: 'denied' } });
    const outcome = await createVisit({ id: VISIT_ROW.id, doctorId: VISIT_ROW.doctor_id }, client);
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');
    expect(outcome.refusal.code).toBe('not_permitted');
  });

  it('throws on a row that does not match the contract', async () => {
    const broken = Object.fromEntries(Object.entries(VISIT_ROW).filter(([k]) => k !== 'status'));
    const { client } = writer({ data: broken, error: null });
    await expect(
      createVisit({ id: VISIT_ROW.id, doctorId: VISIT_ROW.doctor_id }, client),
    ).rejects.toThrow();
  });
});

describe('updateVisit', () => {
  it('sends only the fields the MR owns', async () => {
    // received_at, mr_id and created_at are the server's. There is no reason to send a
    // value whose only correct answer the server already holds.
    const { client, sent } = writer({ data: VISIT_ROW, error: null });
    await updateVisit(
      VISIT_ROW.id,
      { status: 'in_progress', startedAt: '2026-09-07T12:00:00+05:30' },
      client,
    );
    expect(sent[0]).toEqual({ status: 'in_progress', started_at: '2026-09-07T12:00:00+05:30' });
  });

  it('omits fields that were not provided rather than nulling them', async () => {
    const { client, sent } = writer({ data: VISIT_ROW, error: null });
    await updateVisit(VISIT_ROW.id, { status: 'completed' }, client);
    expect(sent[0]).toEqual({ status: 'completed' });
    expect(Object.keys(sent[0] ?? {})).not.toContain('completed_at');
  });
});

describe('listMileage', () => {
  it('maps server rows into contract entities', async () => {
    const outcome = await listMileage(
      '2026-01-01',
      '2026-12-31',
      rpc({
        data: [
          {
            mr_id: VISIT_ROW.mr_id,
            travel_date: '2026-09-07',
            check_in_count: 3,
            distance_metres: 4210.5,
          },
        ],
        error: null,
      }),
    );
    if (outcome.kind !== 'loaded') throw new Error('expected loaded mileage');
    expect(outcome.days).toHaveLength(1);
    expect(outcome.days[0]?.distanceMetres).toBe(4210.5);
    expect(outcome.days[0]?.checkInCount).toBe(3);
  });

  it('treats an empty result as empty, not as a failure', async () => {
    const outcome = await listMileage('2026-01-01', '2026-12-31', rpc({ data: [], error: null }));
    if (outcome.kind !== 'loaded') throw new Error('expected loaded mileage');
    expect(outcome.days).toHaveLength(0);
  });

  it('reports a refusal as a refusal', async () => {
    const outcome = await listMileage(
      '2026-01-01',
      '2026-12-31',
      rpc({ data: null, error: { code: '28000', message: 'not authenticated' } }),
    );
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');
    expect(outcome.refusal.code).toBe('not_authenticated');
  });
});
