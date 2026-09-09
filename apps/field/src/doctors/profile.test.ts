import { describe, expect, it } from 'vitest';
import { ConsentRecordSchema, DoctorSchema, VisitSchema } from '@fieldforce/core';
import type { ConsentRecord, Doctor, Visit } from '@fieldforce/core';
import { buildDoctorProfile, consentLabel, dayMonthFrom } from './profile';

const NOW = Date.parse('2026-08-10T12:00:00+05:30');
const DOC = '33333333-3333-4333-8333-333333333301';
const OTHER = '33333333-3333-4333-8333-333333333302';

const doctor = (): Doctor =>
  DoctorSchema.parse({
    id: DOC,
    fullName: 'Dr V. Kulkarni',
    registrationNumber: null,
    specialty: 'Urology',
    qualification: null,
    territoryId: '11111111-1111-4111-8111-111111111103',
    assignedMrId: '22222222-2222-4222-8222-222222222202',
    clinicAddresses: [
      {
        id: '44444444-4444-4444-8444-444444444401',
        doctorId: DOC,
        label: 'Kulkarni Clinic',
        line1: '1 Road',
        line2: null,
        city: 'Dadar West',
        state: 'Maharashtra',
        postalCode: '400028',
        coordinates: null,
        geofenceRadiusMetres: 120,
      },
    ],
    isActive: true,
    createdAt: '2026-01-01T08:00:00+05:30',
    updatedAt: '2026-01-01T08:00:00+05:30',
  });

const visit = (id: string, over: Partial<Visit> = {}): Visit =>
  VisitSchema.parse({
    id,
    mrId: '22222222-2222-4222-8222-222222222202',
    doctorId: DOC,
    beatPlanId: null,
    clinicAddressId: null,
    status: 'completed',
    notMetReason: null,
    scheduledFor: null,
    startedAt: '2026-07-03T11:00:00+05:30',
    completedAt: '2026-07-03T11:09:00+05:30',
    receivedAt: '2026-07-03T11:10:00+05:30',
    createdAt: '2026-07-03T10:00:00+05:30',
    updatedAt: '2026-07-03T11:10:00+05:30',
    ...over,
  });

const consent = (id: string, visitId: string, over: Partial<ConsentRecord> = {}): ConsentRecord =>
  ConsentRecordSchema.parse({
    id,
    visitId,
    doctorId: DOC,
    capturedByMrId: '22222222-2222-4222-8222-222222222202',
    outcome: 'declined',
    notAskedReason: null,
    consentTextVersionId: '77777777-7777-4777-8777-777777777701',
    displayedLanguage: 'en-IN',
    supersedesConsentRecordId: null,
    isWithdrawal: false,
    capturedAt: '2026-07-03T11:01:00+05:30',
    receivedAt: '2026-07-03T11:02:00+05:30',
    createdAt: '2026-07-03T11:02:00+05:30',
    ...over,
  });

const V1 = '66666666-6666-4666-8666-666666666601';
const V2 = '66666666-6666-4666-8666-666666666602';
const C1 = '88888888-8888-4888-8888-888888888801';
const C2 = '88888888-8888-4888-8888-888888888802';

describe('the MR’s own history with this doctor', () => {
  it('measures the visit from the server’s start and finish', () => {
    const profile = buildDoctorProfile(doctor(), [visit(V1)], [], NOW);
    expect(profile.recentVisits[0]?.minutes).toBe(9);
  });

  it('renders no duration rather than a negative one when the clocks disagreed', () => {
    // "-3 min" is worse than nothing, and there is no honest correction available
    // on the client.
    const profile = buildDoctorProfile(
      doctor(),
      [
        visit(V1, {
          startedAt: '2026-07-03T11:09:00+05:30',
          completedAt: '2026-07-03T11:00:00+05:30',
        }),
      ],
      [],
      NOW,
    );
    expect(profile.recentVisits[0]?.minutes).toBeNull();
  });

  it('orders most recent first', () => {
    const profile = buildDoctorProfile(
      doctor(),
      [
        visit(V1, { completedAt: '2026-06-02T11:06:00+05:30' }),
        visit(V2, { completedAt: '2026-07-03T11:09:00+05:30' }),
      ],
      [],
      NOW,
    );
    expect(profile.recentVisits.map((entry) => entry.visitId)).toEqual([V2, V1]);
  });

  it('ignores another doctor’s visits even when handed them', () => {
    // The route filters by doctorId server-side; this makes the screen safe if that
    // filter is ever dropped, because showing one doctor's history on another's
    // profile is a data-leak shaped bug.
    const profile = buildDoctorProfile(doctor(), [visit(V1, { doctorId: OTHER })], [], NOW);
    expect(profile.recentVisits).toEqual([]);
    expect(profile.daysSince).toBeNull();
  });

  it('counts only completed visits toward "since your last visit"', () => {
    const profile = buildDoctorProfile(
      doctor(),
      [visit(V1, { status: 'planned', completedAt: null })],
      [],
      NOW,
    );
    expect(profile.daysSince).toBeNull();
  });
});

describe('what the doctor said about recording', () => {
  it('attaches the outcome to the visit it belongs to', () => {
    const profile = buildDoctorProfile(doctor(), [visit(V1)], [consent(C1, V1)], NOW);
    expect(profile.recentVisits[0]?.consent).toBe('declined');
  });

  it('takes the latest record for a visit, so a withdrawal wins', () => {
    // A withdrawal supersedes an earlier row without touching it. Reading the first
    // row found would show a consent the doctor has since taken back.
    const profile = buildDoctorProfile(
      doctor(),
      [visit(V1)],
      [
        consent(C1, V1, { outcome: 'consented', receivedAt: '2026-07-03T11:02:00+05:30' }),
        consent(C2, V1, {
          outcome: 'declined',
          isWithdrawal: true,
          receivedAt: '2026-07-04T09:00:00+05:30',
        }),
      ],
      NOW,
    );
    expect(profile.recentVisits[0]?.consent).toBe('declined');
  });

  it('leaves it absent when nothing was recorded', () => {
    const profile = buildDoctorProfile(doctor(), [visit(V1)], [], NOW);
    expect(profile.recentVisits[0]?.consent).toBeNull();
    expect(consentLabel(null)).toBeNull();
  });

  it('words "not asked" without a hint of fault', () => {
    // The contract calls `notAskedReason` "never a penalty field". An MR who did not
    // ask has done nothing wrong, and the label must not imply otherwise.
    expect(consentLabel('not_asked')).toBe('not asked');
    expect(consentLabel('declined')).toBe('declined recording');
    expect(consentLabel('consented')).toBe('agreed to recording');
  });
});

describe('the profile carries nothing about the doctor’s practice', () => {
  it('exposes only visit history, with no field for prescribing or patients', () => {
    // C14 is the design's own boundary, and this asserts it structurally rather than
    // trusting a comment: if somebody adds a prescribing field to the profile, the
    // key set changes and this fails.
    const profile = buildDoctorProfile(doctor(), [visit(V1)], [consent(C1, V1)], NOW);
    expect(Object.keys(profile).sort()).toEqual([
      'daysSince',
      'detail',
      'id',
      'name',
      'recentVisits',
    ]);
    expect(Object.keys(profile.recentVisits[0] ?? {}).sort()).toEqual([
      'completedAt',
      'consent',
      'minutes',
      'startedAt',
      'visitId',
    ]);
  });
});

describe('dates keep the territory’s day', () => {
  it('reads the day off the timestamp rather than reinterpreting the offset', () => {
    // A 23:30 visit in +05:30 is the 3rd there and the 3rd on the screen, whatever
    // timezone the handset is set to.
    expect(dayMonthFrom('2026-07-03T23:30:00+05:30')).toBe('3 Jul');
  });
});
