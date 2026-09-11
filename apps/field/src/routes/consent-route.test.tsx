import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConsentTextVersionSchema, DoctorSchema, VisitSchema } from '@fieldforce/core';

const mockCreateConsentRecord = jest.fn<(body: unknown) => Promise<unknown>>();
/**
 * MR-23 B1. The last gating read moved off the mock. The visit and doctor now come from
 * the pulled store; the notices come from Supabase under RLS through
 * `src/consent/notices.ts`.
 *
 * Mocked rather than wrapped in real providers because `pulled-store.tsx` imports
 * `../session` -> `../supabase` -> `../config`, whose `loadAppConfig` throws at module load
 * with no `.env`. `notices.ts` reaches the same client. The provider itself is exercised
 * for real in `src/sync/pulled-store.test.tsx`.
 */
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
/**
 * **MR-26 B1. The notices are no longer fetched, so there is nothing here to mock.**
 *
 * They travel in `sync_pull` as their own entity and the screen reads them out of the pulled
 * store with `noticesFromStore`, which is why consent can now be captured with no signal --
 * MR-25 D1 measured that it could not. These cases therefore seed the STORE, which is both
 * simpler and closer to the product: the previous version stubbed two network calls the
 * screen no longer makes, and would have kept passing over a screen that had stopped working.
 */
// MR-18 B1. The WRITE boundary moved from the mock REST client to `sync_push`, so the
// mock moved with it. The reads on these screens are still `createClientForScenario`, and
// both are mocked here because the screen uses both -- which is exactly the two-column
// distinction the real-versus-fixture table is about.
jest.mock('../sync/push-client', () => ({
  createPushClient: () => ({ createConsentRecord: mockCreateConsentRecord }),
}));
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: mockBack }),
  useLocalSearchParams: () => ({ visitId: '44444444-4444-4444-8444-444444444401' }),
}));

import ConsentRoute from '../../app/consent/[visitId]';

const visit = VisitSchema.parse({
  id: '44444444-4444-4444-8444-444444444401',
  mrId: '44444444-4444-4444-8444-4444444444aa',
  doctorId: '44444444-4444-4444-8444-4444444444bb',
  beatPlanId: null,
  clinicAddressId: null,
  status: 'in_progress',
  notMetReason: null,
  scheduledFor: null,
  startedAt: '2026-08-14T11:58:00+05:30',
  completedAt: null,
  receivedAt: '2026-08-14T11:58:01+05:30',
  createdAt: '2026-08-14T08:00:00+05:30',
  updatedAt: '2026-08-14T11:58:01+05:30',
});

const doctor = DoctorSchema.parse({
  id: '44444444-4444-4444-8444-4444444444bb',
  fullName: 'Dr. S. Iyer',
  registrationNumber: null,
  specialty: 'Urologist',
  qualification: null,
  territoryId: '44444444-4444-4444-8444-4444444444cc',
  assignedMrId: null,
  clinicAddresses: [],
  isActive: true,
  createdAt: '2026-08-01T08:00:00+05:30',
  updatedAt: '2026-08-01T08:00:00+05:30',
});

const notice = ConsentTextVersionSchema.parse({
  id: '44444444-4444-4444-8444-4444444444dd',
  versionLabel: 'v1.2',
  language: 'en-IN',
  fullText: 'I agree that this conversation may be audio recorded.',
  hash: 'a1b2c3d4'.repeat(8),
  effectiveFrom: '2026-07-01T00:00:00+05:30',
  effectiveUntil: null,
  createdAt: '2026-07-01T00:00:00+05:30',
});

// `const me = { profile: { fullName: 'Rahul More' }, ... }` stood here and is gone with
// `getMe()`. It was the source of the fixture name the DPDP fiduciary line showed a
// doctor -- see "does NOT name the rep" below.

/** A settled store holding the visit and doctor this screen is about. */
const pulled = (visits: unknown[], doctors: unknown[], notices: unknown[] = []) => ({
  store: {
    visit: new Map(visits.map((v) => [(v as { id: string }).id, v])),
    doctor: new Map(doctors.map((d) => [(d as { id: string }).id, d])),
    beat_plan: new Map(),
    clinic_address: new Map(),
    consent_text_version: new Map(notices.map((n) => [(n as { id: string }).id, n])),
  },
  status: 'ready',
  notice: null,
  failure: null,
  resynced: false,
  removals: [],
  zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  today: '2026-08-14',
  refresh: jest.fn(),
});

const loaded = (): void => {
  mockStore.mockReturnValue(pulled([visit], [doctor], [notice]));
  mockCreateConsentRecord.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
};

describe('app/consent/[visitId].tsx — the handoff', () => {
  it('shows the doctor the server’s notice, not copy the app wrote', async () => {
    loaded();
    await render(<ConsentRoute />);
    expect(await screen.findByText(notice.fullText)).toBeTruthy();
    expect(screen.getByText('Notice v1.2 · English · a1b2c3d4')).toBeTruthy();
  });

  it('does NOT name the rep, because the token does not carry a name', async () => {
    // **This test asserted the opposite and passed, which is why it is worth keeping.**
    // It was named "names the rep from the token" and the screen's own comment claimed
    // the same. Measured against a real token, the claims are `app_role`,
    // `app_territory_id`, `app_is_active` and `email` -- no name and no company. The name
    // was coming from `getMe()` against the MOCK, so the DPDP fiduciary line named a
    // FIXTURE rep to a real doctor.
    //
    // `fiduciaryNote(null, ...)` and `askedBy` already had honest fallbacks. This asserts
    // the fallback rather than the fiction, and it will fail the day a name genuinely
    // reaches the client -- which is the point at which the copy should change.
    loaded();
    await render(<ConsentRoute />);
    expect(screen.queryByText('Rahul More')).toBeNull();
    expect(await screen.findByText(/Your rep/u)).toBeTruthy();
  });

  it('records a decline against the version that was on the screen', async () => {
    // A decline is a completion, not a failure, and it goes down the same path as a
    // yes — including carrying the version id and language that were displayed.
    loaded();
    mockCreateConsentRecord.mockResolvedValue({});
    await render(<ConsentRoute />);
    await screen.findByText(notice.fullText);

    await fireEvent.press(screen.getByText("No, don't record"));

    expect(mockCreateConsentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        visitId: visit.id,
        doctorId: doctor.id,
        outcome: 'declined',
        consentTextVersionId: notice.id,
        displayedLanguage: 'en-IN',
        notAskedReason: null,
      }),
    );
  });

  it('records a consent through the same call, with no faster path', async () => {
    loaded();
    mockCreateConsentRecord.mockResolvedValue({});
    await render(<ConsentRoute />);
    await screen.findByText(notice.fullText);

    await fireEvent.press(screen.getByText("Yes, that's fine"));

    expect(mockCreateConsentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'consented', consentTextVersionId: notice.id }),
    );
  });

  it('writes nothing at all when the phone is simply handed back', async () => {
    // The exit that is not a decision. `not_asked` exists for a visit where the
    // question was never put, and it takes a reason the MR gives — writing it here
    // would be the app answering on the doctor's behalf.
    loaded();
    await render(<ConsentRoute />);
    await screen.findByText(notice.fullText);

    await fireEvent.press(screen.getByText('Give the phone back'));

    expect(mockCreateConsentRecord).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows no answers when the handset holds NO notice and the pull could not run', async () => {
    // MR-26 B1. This used to stub a rejected fetch. There is no fetch now, so the state it
    // stood for is expressed directly: an empty store AND a failed pull, which is the only
    // combination that means the app does not KNOW whether a notice exists. With notices in
    // the store and none for this language the right sentence is "none published yet", and
    // saying "could not be loaded" there would be the lie this distinction prevents.
    mockStore.mockReturnValue({
      ...pulled([visit], [doctor], []),
      failure: { kind: 'unreachable' },
    });
    mockCreateConsentRecord.mockClear();
    await render(<ConsentRoute />);

    expect(await screen.findByText('The consent notice could not be loaded')).toBeTruthy();
    expect(screen.queryByText("Yes, that's fine")).toBeNull();
  });

  it('THE POSITIVE CONTROL: a failed pull does NOT block when the notice is in the store', async () => {
    // The defect MR-26 B3 found in three screens: a failed BACKGROUND refresh rendered as
    // "this screen has no data", over a store that held everything. Consent offline is the
    // whole point of B1, so this is the case that proves it.
    mockStore.mockReturnValue({
      ...pulled([visit], [doctor], [notice]),
      failure: { kind: 'unreachable' },
    });
    mockCreateConsentRecord.mockClear();
    await render(<ConsentRoute />);

    expect(await screen.findByText(notice.fullText)).toBeTruthy();
    expect(screen.getByText("Yes, that's fine")).toBeTruthy();
  });

  it('offers only the languages the server has a live notice in', async () => {
    const hindi = ConsentTextVersionSchema.parse({
      ...notice,
      id: '44444444-4444-4444-8444-4444444444ee',
      language: 'hi-IN',
      hash: 'b'.repeat(64),
    });
    const retired = ConsentTextVersionSchema.parse({
      ...notice,
      id: '44444444-4444-4444-8444-4444444444ff',
      language: 'mr-IN',
      hash: 'c'.repeat(64),
      effectiveUntil: '2026-08-01T00:00:00+05:30',
    });
    mockStore.mockReturnValue(pulled([visit], [doctor], [notice, hindi, retired]));
    mockCreateConsentRecord.mockClear();

    await render(<ConsentRoute />);
    await screen.findByText(notice.fullText);

    // A retired notice is never offered: it would produce a record attesting to
    // text the company has already replaced.
    expect(screen.getByLabelText('Language')).toBeTruthy();
    expect(screen.queryByText('मराठी')).toBeNull();
  });
});
