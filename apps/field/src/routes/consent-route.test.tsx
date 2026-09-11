import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DoctorSchema, PulledConsentTextVersionSchema, VisitSchema } from '@fieldforce/core';

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
  // `createPushClient` is replaced; `SyncPushRefusal` is kept REAL. `sendOrQueue` classifies
  // by `instanceof`, so a look-alike class would be treated as a transport failure and the
  // refusal path -- the one under test -- would never run. MR-24's defect 2 was exactly that
  // mistake in production code; a test that made it here would prove nothing.
  ...jest.requireActual<Record<string, unknown>>('../sync/push-client'),
  createPushClient: () => ({ createConsentRecord: mockCreateConsentRecord }),
}));
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: mockBack }),
  useLocalSearchParams: () => ({ visitId: '44444444-4444-4444-8444-444444444401' }),
}));

import { SyncPushRefusal } from '../sync/push-client';
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

// MR-27 B1. `precedence` is what the SERVER ranks this row, transmitted by the pull. The
// fixtures carry it because the pull cannot produce a notice without one -- a fixture
// missing it would be a shape no client ever sees, which is how gate1.spec.ts went wrong.
const notice = PulledConsentTextVersionSchema.parse({
  precedence: 1,
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
  // MR-28 A2. The clock the activation window is applied against. It is the SERVER's, from
  // the last pull -- not `new Date()`, which is what this screen used and which MR-15 A2
  // forbids for the day boundary for the same reason: a handset running fast displays a
  // notice that is not yet active and `capture_consent` refuses it at 45001, in front of a
  // doctor.
  serverTime: '2026-08-14T12:00:00+05:30',
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

  // ---------------------------------------------------------------------------------------
  // MR-28 A2 -- WHICH CLOCK the activation window uses. These three are two-sided about the
  // one thing that matters: the answer must change with the SERVER's time and must not
  // change with the handset's. Each fixture below is built so the two clocks DISAGREE, which
  // is the only arrangement that can tell them apart -- a notice active under both proves
  // nothing, and that is why the defect survived MR-27.
  // ---------------------------------------------------------------------------------------

  it('OFFERS a notice the SERVER’s clock has reached, though the handset’s has not', async () => {
    // `effectiveFrom` is in the future by the machine running this test and in the past by
    // `serverTime`. On `new Date()` the screen said "There is no consent notice for this
    // language yet" -- a published, live notice withheld from a doctor who was sitting there.
    const scheduled = PulledConsentTextVersionSchema.parse({
      ...notice,
      id: '44444444-4444-4444-8444-4444444444de',
      versionLabel: 'v2.0-monday',
      fullText: 'Monday wording: this conversation may be audio recorded.',
      effectiveFrom: '2099-01-01T00:00:00+05:30',
    });
    mockStore.mockReturnValue({
      ...pulled([visit], [doctor], [scheduled]),
      serverTime: '2099-06-01T09:00:00+05:30',
    });
    mockCreateConsentRecord.mockClear();
    await render(<ConsentRoute />);

    expect(await screen.findByText(scheduled.fullText)).toBeTruthy();
    expect(screen.queryByText('There is no consent notice for this language yet')).toBeNull();
  });

  it('WITHHOLDS a notice the handset’s clock has reached and the SERVER’s has not', async () => {
    // The other side, and the one with a doctor waiting: a fast handset would display
    // Monday's notice on Sunday, the doctor would answer it, and `capture_consent`
    // re-resolves at the SERVER's clock and refuses -- 45001, after the conversation.
    // Nothing is shown here because nothing is servable, and the app says so plainly.
    const scheduled = PulledConsentTextVersionSchema.parse({
      ...notice,
      id: '44444444-4444-4444-8444-4444444444df',
      versionLabel: 'v2.0-monday',
      // Computed from the DEVICE's now rather than hardcoded, so the two clocks disagree
      // whatever day this suite is run on: yesterday by the handset, next year by the
      // server's stale `serverTime`. A fixed date here would drift into agreement and the
      // case would pass against the defect -- which it did on the first attempt.
      effectiveFrom: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    mockStore.mockReturnValue({
      ...pulled([visit], [doctor], [scheduled]),
      serverTime: '2020-01-01T12:00:00+05:30',
    });
    mockCreateConsentRecord.mockClear();
    await render(<ConsentRoute />);

    expect(
      await screen.findByText('There is no consent notice for this language yet'),
    ).toBeTruthy();
    expect(screen.queryByText(scheduled.fullText)).toBeNull();
    expect(screen.queryByText("Yes, that's fine")).toBeNull();
  });

  it('with NO server clock, declines to decide the window rather than guessing', async () => {
    // A cold start that has never completed a pull holds notices from disk and no
    // `serverTime`. There is no honest answer to "is this one active" -- so the screen does
    // not offer one. It says the notice could not be loaded, which is the true sentence:
    // the notice ROWS are here, the thing needed to serve one is not. Falling back to
    // `new Date()` here is `FE-W40` option B and is refused for the same reason.
    mockStore.mockReturnValue({ ...pulled([visit], [doctor], [notice]), serverTime: null });
    mockCreateConsentRecord.mockClear();
    await render(<ConsentRoute />);

    expect(await screen.findByText('The consent notice could not be loaded')).toBeTruthy();
    expect(screen.queryByText(notice.fullText)).toBeNull();
    expect(screen.queryByText("Yes, that's fine")).toBeNull();
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

  it('SHOWS a server refusal with its remedy, and does NOT navigate away', async () => {
    // **MR-27 C1, found by driving a real 45001 from the screen.** The handler awaited
    // `sendOrQueue` and DISCARDED the outcome, then navigated back whatever the server said.
    // So the doctor answered, `capture_consent` refused it, the app went quiet, and no
    // record existed -- with nothing on the queue screen either, because since MR-24 a
    // refusal is not queued.
    //
    // Staying put is also the 45001 remedy: re-read the CURRENT notice and ask once more.
    loaded();
    mockCreateConsentRecord.mockRejectedValue(
      new SyncPushRefusal({
        message: 'the consent notice changed since it was displayed; re-read and ask again',
        sqlState: '45001',
        rejectionCode: 'internal_error',
        deadLettered: false,
      }),
    );
    await render(<ConsentRoute />);
    await screen.findByText(notice.fullText);
    await fireEvent.press(screen.getByText("Yes, that's fine"));

    // The MR-facing REMEDY, not backend's sentence for support.
    expect(await screen.findByText(/read the current notice aloud/i)).toBeTruthy();
    // A refusal must not send them back as though it worked.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('THE POSITIVE CONTROL: an ACCEPTED capture still navigates straight back', async () => {
    // Without this, "never navigate" would satisfy the case above and strand every MR on the
    // consent screen after a successful answer -- with the phone still in the doctor's hand,
    // which is the one place this screen must not linger.
    loaded();
    mockCreateConsentRecord.mockResolvedValue({ receivedAt: '2026-09-11T10:00:00.000Z' });
    await render(<ConsentRoute />);
    await screen.findByText(notice.fullText);
    await fireEvent.press(screen.getByText("Yes, that's fine"));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/read the current notice aloud/i)).toBeNull();
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
    const hindi = PulledConsentTextVersionSchema.parse({
      ...notice,
      id: '44444444-4444-4444-8444-4444444444ee',
      language: 'hi-IN',
      hash: 'b'.repeat(64),
      // Its own language, so the server ranks it first in that partition.
      precedence: 1,
    });
    const retired = PulledConsentTextVersionSchema.parse({
      ...notice,
      id: '44444444-4444-4444-8444-4444444444ff',
      language: 'mr-IN',
      hash: 'c'.repeat(64),
      precedence: 1,
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
