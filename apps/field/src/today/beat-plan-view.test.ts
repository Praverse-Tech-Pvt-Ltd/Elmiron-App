import { describe, expect, it } from 'vitest';
import { BeatPlanRecordSchema, DoctorSchema, VisitSchema } from '@fieldforce/core';
import type {
  BeatPlanEntry,
  BeatPlanRecord,
  BeatPlanStatus,
  Doctor,
  Visit,
} from '@fieldforce/core';
import { beatPlanView, onPlanDoctorIds, planStatusLine, todaysPlan } from './beat-plan-view';
import type { BeatPlanViewInput } from './beat-plan-view';
import { territoryToday } from './territory-day';
import type { TerritoryZone } from './territory-day';

/**
 * `BE-W89`, client half — MR-45 B2, B3 and B4, asserted without a renderer.
 *
 * The screen is a binding; every decision it presents is made in `beat-plan-view.ts`, so that
 * is where the claims are pinned.
 */

const MR = '22222222-2222-4222-8222-222222222202';
const TERRITORY = '11111111-1111-4111-8111-111111111103';
const PLAN = '55555555-5555-4555-8555-555555555501';
const OLD_PLAN = '55555555-5555-4555-8555-555555555500';
const D1 = '33333333-3333-4333-8333-333333333301';
const D2 = '33333333-3333-4333-8333-333333333302';

const IST: TerritoryZone = { timeZone: 'Asia/Kolkata', source: 'territory' };
const UTC: TerritoryZone = { timeZone: 'UTC', source: 'fallback_utc' };

const record = (over: Partial<BeatPlanRecord> = {}): BeatPlanRecord =>
  BeatPlanRecordSchema.parse({
    id: PLAN,
    mrId: MR,
    territoryId: TERRITORY,
    planDate: '2026-09-21',
    status: 'submitted',
    approvedByUserId: null,
    approvedAt: null,
    version: 1,
    supersedesBeatPlanId: null,
    createdAt: '2026-09-20T08:00:00.000Z',
    updatedAt: '2026-09-20T08:00:00.000Z',
    ...over,
  });

const entry = (id: string, doctorId: string, plannedSequence: number): BeatPlanEntry => ({
  id,
  beatPlanId: PLAN,
  doctorId,
  clinicAddressId: null,
  plannedSequence,
});

const doctor = (id: string, name: string): Doctor =>
  DoctorSchema.parse({
    id,
    fullName: name,
    registrationNumber: null,
    specialty: 'Urology',
    qualification: null,
    territoryId: TERRITORY,
    assignedMrId: MR,
    clinicAddresses: [],
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  });

const input = (over: Partial<BeatPlanViewInput> = {}): BeatPlanViewInput => ({
  status: 'ready',
  today: '2026-09-21',
  plans: [record()],
  entries: [
    entry('55555555-5555-4555-8555-555555555512', D2, 2),
    entry('55555555-5555-4555-8555-555555555511', D1, 1),
  ],
  visits: [],
  doctors: [doctor(D1, 'Dr Asha Deshpande'), doctor(D2, 'Dr Vikram Rao')],
  zone: IST,
  ...over,
});

// ---------------------------------------------------------------------------------------------
// B2 — the status line, and the ABSENCE of the approved wording
// ---------------------------------------------------------------------------------------------

describe('BE-W89 B2 — the plan says what state it is in', () => {
  it('says a submitted plan is submitted and not yet approved', () => {
    expect(planStatusLine('submitted')).toBe('Submitted — not yet approved');
  });

  it('never uses the approved wording for a plan that is not approved — asserted as an absence', () => {
    // The presence check above cannot catch a line that says both, e.g. "Submitted — approved".
    // This one can. Every non-approved status is checked, because nothing in v1 writes
    // `approved`: a plan the MR sees is almost always one of these, and the claim that a
    // manager approved it would be false.
    const notApproved: readonly BeatPlanStatus[] = ['submitted', 'draft', 'rejected'];
    for (const status of notApproved) {
      expect(planStatusLine(status)).not.toMatch(/\bapproved by\b/iu);
      expect(planStatusLine(status)).not.toMatch(/^approved/iu);
    }
  });

  it('does use it for an approved plan — the positive control for the absence above', () => {
    // Without this, a status line that never said "approved" for ANY input would pass the
    // absence test while being wrong about the one case where the word is true.
    expect(planStatusLine('approved')).toMatch(/^Approved by your manager$/u);
  });

  it('carries the status line through to the screen for a submitted plan', () => {
    const view = beatPlanView(input());
    expect(view.kind).toBe('route');
    expect(view.kind === 'route' ? view.statusLine : '').toBe('Submitted — not yet approved');
  });

  it('shows a submitted plan at all — the old filter kept only approved ones', () => {
    // The six-week defect in one line: `.filter((plan) => plan.status === 'approved')`, with
    // nothing in the system ever writing `approved`. A submitted plan must reach the screen.
    const view = beatPlanView(input({ plans: [record({ status: 'submitted' })] }));
    expect(view.kind).not.toBe('no-plan');
  });
});

// ---------------------------------------------------------------------------------------------
// B3 — today is the SERVER's date in the TERRITORY's zone, at a boundary that exposes it
// ---------------------------------------------------------------------------------------------

describe('BE-W89 B3 — which plan is today’s, across the 18:30Z boundary', () => {
  // 18:45Z is 00:15 IST on the NEXT day. At this instant the UTC date and the IST date differ,
  // so a screen reckoning "today" in the wrong zone picks the wrong plan. 07:44Z is the same
  // date in both zones and would prove nothing.
  const SERVER_TIME = '2026-09-20T18:45:00.000Z';

  const monday = record({ id: PLAN, planDate: '2026-09-21' });
  const sunday = record({ id: OLD_PLAN, planDate: '2026-09-20' });

  it('computes the territory date, not the UTC date, from the server instant', () => {
    // The real function, not a hand-written date: this is what `usePulledStore().today` holds.
    expect(territoryToday(SERVER_TIME, IST)).toBe('2026-09-21');
    expect(territoryToday(SERVER_TIME, UTC)).toBe('2026-09-20');
  });

  it('picks MONDAY’s plan in IST at 18:45Z', () => {
    expect(todaysPlan([sunday, monday], territoryToday(SERVER_TIME, IST))?.id).toBe(PLAN);
  });

  it('picks SUNDAY’s plan under the UTC fallback at the same instant', () => {
    // The two assertions together are the point: the same server instant, the same two plans,
    // and the zone alone decides which one the MR follows.
    expect(todaysPlan([sunday, monday], territoryToday(SERVER_TIME, UTC))?.id).toBe(OLD_PLAN);
  });

  it('takes the newest version when a plan was changed on the day', () => {
    const v1 = record({ id: OLD_PLAN, version: 1 });
    const v2 = record({ id: PLAN, version: 2, supersedesBeatPlanId: OLD_PLAN });
    expect(todaysPlan([v2, v1], '2026-09-21')?.id).toBe(PLAN);
    expect(todaysPlan([v1, v2], '2026-09-21')?.id).toBe(PLAN);
  });

  it('decides nothing without a server date — the handset’s date is never a fallback', () => {
    expect(todaysPlan([monday], null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// B4 — three ways to be empty, and they must not look alike
// ---------------------------------------------------------------------------------------------

describe('BE-W89 B4 — a plan whose stops have not arrived is not an empty plan', () => {
  it('says the stops are syncing when the plan is here and the pull has not settled', () => {
    // THE case this screen was left on the mock for: plan present, entries still in flight.
    const view = beatPlanView(input({ status: 'loading', entries: [] }));
    expect(view.kind).toBe('syncing');
  });

  it('says the plan has no stops only once the pull HAS settled', () => {
    const view = beatPlanView(input({ status: 'ready', entries: [] }));
    expect(view.kind).toBe('no-stops');
  });

  it('never says "no plan" while the pull is still running', () => {
    // "No plan" is a claim about the server. With the pull unsettled, the plan may be on its way.
    const view = beatPlanView(input({ status: 'loading', plans: [] }));
    expect(view.kind).toBe('loading');
  });

  it('says "no plan" when the pull has settled and there is none', () => {
    const view = beatPlanView(input({ status: 'ready', plans: [] }));
    expect(view.kind).toBe('no-plan');
  });

  it('does not count another plan’s entries as this plan’s stops', () => {
    // Entries are a flat slice of the store. Joining on beatPlanId is what makes them THIS
    // plan's; without the join, yesterday's stops would appear on today's route.
    const stray = { ...entry('55555555-5555-4555-8555-555555555599', D1, 1), beatPlanId: OLD_PLAN };
    const view = beatPlanView(input({ status: 'ready', entries: [stray] }));
    expect(view.kind).toBe('no-stops');
  });

  it('refuses to guess when the pull failed and no server date exists', () => {
    expect(beatPlanView(input({ status: 'failed', today: null })).kind).toBe('unreachable');
  });
});

describe('BE-W89 — the route uses the server’s stop order and names', () => {
  it('orders stops by plannedSequence, not by the order they arrived', () => {
    // The input deliberately lists sequence 2 first.
    const view = beatPlanView(input());
    const names = view.kind === 'route' ? view.route.stops.map((s) => s.doctorName) : [];
    expect(names).toEqual(['Dr Asha Deshpande', 'Dr Vikram Rao']);
  });

  it('names a stop whose doctor is not on the handset rather than dropping it — FE-W51', () => {
    const view = beatPlanView(input({ doctors: [doctor(D1, 'Dr Asha Deshpande')] }));
    const names = view.kind === 'route' ? view.route.stops.map((s) => s.doctorName) : [];
    expect(names).toEqual(['Dr Asha Deshpande', 'Doctor not in your list']);
  });
});

// ---------------------------------------------------------------------------------------------
// B3, found on the device — a visit counts only on the day it happened
// ---------------------------------------------------------------------------------------------

/** A completed visit to `doctorId`, finishing at `completedAt`. */
const completed = (doctorId: string, completedAt: string): Visit =>
  VisitSchema.parse({
    id: '44444444-4444-4444-8444-44444444440' + doctorId.slice(-1),
    mrId: MR,
    doctorId,
    beatPlanId: null,
    clinicAddressId: null,
    status: 'completed',
    notMetReason: null,
    scheduledFor: null,
    startedAt: completedAt,
    completedAt,
    receivedAt: completedAt,
    createdAt: completedAt,
    updatedAt: completedAt,
  });

const doneNames = (i: BeatPlanViewInput): readonly string[] => {
  const view = beatPlanView(i);
  return view.kind === 'route'
    ? view.route.stops.filter((s) => s.state === 'done').map((s) => s.doctorName)
    : [];
};

describe('BE-W89 B3 — a visit on ANOTHER day is not done on today’s route', () => {
  it('does not mark a doctor done for a visit five days ago', () => {
    // The Pixel 10 showed exactly this: a visit to Dr Meera Iyer on 16 September rendered as
    // DONE on 21 September's route, and the header said "3 planned · 1 done" on a day nobody
    // had been seen. `buildDayRoute` matches by doctor alone; the store holds all history.
    const visits = [completed(D1, '2026-09-16T09:49:00.000Z')];
    expect(doneNames(input({ visits }))).toEqual([]);
  });

  it('does mark a doctor done for a visit today — the positive control', () => {
    // Without this, a filter that dropped EVERY visit would pass the test above.
    const visits = [completed(D1, '2026-09-21T06:00:00.000Z')];
    expect(doneNames(input({ visits }))).toEqual(['Dr Asha Deshpande']);
  });

  it('counts a visit finished at 18:45Z on the 20th as the 21st in IST', () => {
    // 18:45Z is 00:15 IST on the 21st. The SERVER's `coverage()` puts it on the 21st, because
    // it reckons `completed_at` in Asia/Kolkata. The route must agree, or the MR and their
    // manager see two different answers to "was this doctor seen today".
    const visits = [completed(D1, '2026-09-20T18:45:00.000Z')];
    expect(doneNames(input({ visits, zone: IST }))).toEqual(['Dr Asha Deshpande']);
  });

  it('and as the 20th under the UTC fallback, so it is NOT on the 21st’s route', () => {
    // The same instant, the same plan: the zone alone decides whether the visit counts.
    const visits = [completed(D1, '2026-09-20T18:45:00.000Z')];
    expect(doneNames(input({ visits, zone: UTC }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// MR-46 D1 — the Doctors screen's "On plan" chip, at values that would expose a defect
// ---------------------------------------------------------------------------------------------

describe('BE-W89 D1 — "On plan" keeps exactly the doctors on the plan the Beat plan screen shows', () => {
  const D3 = '33333333-3333-4333-8333-333333333303';
  const D4 = '33333333-3333-4333-8333-333333333304';
  const YESTERDAY_PLAN = '55555555-5555-4555-8555-555555555499';

  /**
   * Three plans for one MR: yesterday's with D3 on it, and two versions of today's. Version 1
   * had D4; version 2, which supersedes it, has D1 and D2. D1 also has a visit from five days ago.
   */
  const crowded = (over: Partial<BeatPlanViewInput> = {}): BeatPlanViewInput =>
    input({
      plans: [
        record({ id: YESTERDAY_PLAN, planDate: '2026-09-20' }),
        record({ id: OLD_PLAN, version: 1 }),
        record({ id: PLAN, version: 2, supersedesBeatPlanId: OLD_PLAN }),
      ],
      entries: [
        { ...entry('55555555-5555-4555-8555-555555555590', D3, 1), beatPlanId: YESTERDAY_PLAN },
        { ...entry('55555555-5555-4555-8555-555555555591', D4, 1), beatPlanId: OLD_PLAN },
        entry('55555555-5555-4555-8555-555555555511', D1, 1),
        entry('55555555-5555-4555-8555-555555555512', D2, 2),
      ],
      visits: [completed(D1, '2026-09-16T09:49:00.000Z')],
      doctors: [
        doctor(D1, 'Dr Asha Deshpande'),
        doctor(D2, 'Dr Vikram Rao'),
        doctor(D3, 'Dr Meera Iyer'),
        doctor(D4, 'Dr Kiran Shah'),
      ],
      ...over,
    });

  const onPlan = (i: BeatPlanViewInput): readonly string[] | null => {
    const ids = onPlanDoctorIds(beatPlanView(i));
    return ids === null ? null : [...ids].sort();
  };

  it('keeps the doctors on today’s plan — and only those', () => {
    expect(onPlan(crowded())).toEqual([D1, D2].sort());
  });

  it('leaves out a doctor who is only on YESTERDAY’s plan', () => {
    expect(onPlan(crowded())).not.toContain(D3);
  });

  it('keeps a doctor on today’s plan who has a PAST visit — the plan decides, not the visit', () => {
    // D1 was seen on the 16th. That must neither drop them from the chip nor mark them done.
    expect(onPlan(crowded())).toContain(D1);
    const view = beatPlanView(crowded());
    expect(view.kind === 'route' ? view.route.done : null).toBe(0);
  });

  it('leaves out a doctor only on a SUPERSEDED version of today’s plan', () => {
    expect(onPlan(crowded())).not.toContain(D4);
  });

  it('follows the territory date across 18:30Z: at 18:45Z on the 20th, today is the 21st in IST', () => {
    const today = territoryToday('2026-09-20T18:45:00.000Z', IST);
    expect(onPlan(crowded({ today }))).toEqual([D1, D2].sort());
    // And the UTC reading of the same instant is the 20th -- yesterday's plan, D3 alone.
    const utcToday = territoryToday('2026-09-20T18:45:00.000Z', UTC);
    expect(onPlan(crowded({ today: utcToday, zone: UTC }))).toEqual([D3]);
  });

  it('is NOT OFFERED while the stops are still syncing — an empty filter there would be false', () => {
    expect(onPlan(crowded({ status: 'loading', entries: [] }))).toBeNull();
  });

  it('is NOT OFFERED when there is no plan today, while loading, or when the pull failed', () => {
    expect(
      onPlan(crowded({ plans: [record({ id: YESTERDAY_PLAN, planDate: '2026-09-20' })] })),
    ).toBeNull();
    expect(onPlan(crowded({ today: null }))).toBeNull();
    expect(onPlan(crowded({ today: null, status: 'failed' }))).toBeNull();
  });

  it('IS offered, and empty, when today’s plan has settled with no stops — that is true', () => {
    expect(onPlan(crowded({ entries: [] }))).toEqual([]);
  });
});
