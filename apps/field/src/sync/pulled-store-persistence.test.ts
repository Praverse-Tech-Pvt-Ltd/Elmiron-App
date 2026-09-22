import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), multiRemove: vi.fn() },
}));

import { deserialise } from './pulled-store-persistence';

/**
 * MR-47 / `BE-W107` — a phone that stored visits before the pull carried `visit_day` must
 * re-sync, not keep them with no day.
 *
 * `VisitSchema` defaults a missing `visitDay` to null, so a stored visit without the key would
 * load cleanly — and the cursor would never send it again, leaving it on no plan's day for ever.
 * The loader refuses such a store; `loadPulledStore` then clears the cursor and the next pull is
 * a full re-sync.
 */
const visit = {
  id: '44444444-4444-4444-8444-444444444401',
  mrId: '22222222-2222-4222-8222-222222222202',
  doctorId: '33333333-3333-4333-8333-333333333301',
  beatPlanId: null,
  clinicAddressId: null,
  status: 'completed',
  notMetReason: null,
  scheduledFor: null,
  startedAt: '2026-09-21T06:00:00.000Z',
  completedAt: '2026-09-21T06:30:00.000Z',
  visitDay: '2026-09-21',
  receivedAt: '2026-09-21T06:30:01.000Z',
  createdAt: '2026-09-21T06:00:00.000Z',
  updatedAt: '2026-09-21T06:30:01.000Z',
};

const stored = (visits: readonly unknown[]): unknown => ({
  version: 1,
  visit: visits,
  doctor: [],
  beat_plan: [],
  beat_plan_entry: [],
  clinic_address: [],
  consent_text_version: [],
});

describe('BE-W107 — a stored visit without its server day forces a re-sync', () => {
  it('POSITIVE CONTROL: a store written by this build loads, with the day intact', () => {
    const loaded = deserialise(stored([visit]));
    expect(loaded?.visit.get(visit.id)?.visitDay).toBe('2026-09-21');
  });

  it('REFUSES a store whose visit predates visit_day, so the cursor is cleared', () => {
    const before: Record<string, unknown> = { ...visit };
    delete before['visitDay'];
    expect(deserialise(stored([before]))).toBeNull();
  });

  it('keeps a visit whose day the server said was null — a key present is not a key missing', () => {
    const loaded = deserialise(stored([{ ...visit, visitDay: null }]));
    expect(loaded?.visit.get(visit.id)?.visitDay).toBeNull();
  });
});
