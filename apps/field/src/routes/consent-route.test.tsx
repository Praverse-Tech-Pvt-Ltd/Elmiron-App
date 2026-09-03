import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConsentTextVersionSchema, DoctorSchema, VisitSchema } from '@fieldforce/core';

const mockListVisits = jest.fn<() => Promise<unknown>>();
const mockListDoctors = jest.fn<() => Promise<unknown>>();
const mockGetMe = jest.fn<() => Promise<unknown>>();
const mockListConsentTextVersions = jest.fn<() => Promise<unknown>>();
const mockGetActiveConsentText = jest.fn<() => Promise<unknown>>();
const mockCreateConsentRecord = jest.fn<(body: unknown) => Promise<unknown>>();
jest.mock('../api', () => ({
  createClientForScenario: () => ({
    listVisits: mockListVisits,
    listDoctors: mockListDoctors,
    getMe: mockGetMe,
    listConsentTextVersions: mockListConsentTextVersions,
    getActiveConsentText: mockGetActiveConsentText,
    createConsentRecord: mockCreateConsentRecord,
  }),
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

const me = {
  profile: {
    id: '44444444-4444-4444-8444-4444444444aa',
    fullName: 'Rahul More',
    email: 'rahul@example.in',
    role: 'mr',
    territoryId: '44444444-4444-4444-8444-4444444444cc',
    reportingManagerId: null,
    isActive: true,
    createdAt: '2026-08-01T08:00:00+05:30',
    updatedAt: '2026-08-01T08:00:00+05:30',
  },
  visibleTerritoryIds: [],
};

const loaded = (): void => {
  mockListVisits.mockResolvedValue({ items: [visit] });
  mockListDoctors.mockResolvedValue({ items: [doctor] });
  mockGetMe.mockResolvedValue(me);
  mockListConsentTextVersions.mockResolvedValue({ items: [notice] });
  mockGetActiveConsentText.mockResolvedValue(notice);
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

  it('names the rep from the token', async () => {
    loaded();
    await render(<ConsentRoute />);
    expect(await screen.findByText('Rahul More')).toBeTruthy();
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

  it('shows no answers when the notice cannot be fetched', async () => {
    loaded();
    mockGetActiveConsentText.mockRejectedValue(new Error('Network request failed'));
    await render(<ConsentRoute />);

    expect(await screen.findByText('The consent notice could not be loaded')).toBeTruthy();
    expect(screen.queryByText("Yes, that's fine")).toBeNull();
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
    loaded();
    mockListConsentTextVersions.mockResolvedValue({ items: [notice, hindi, retired] });

    await render(<ConsentRoute />);
    await screen.findByText(notice.fullText);

    // A retired notice is never offered: it would produce a record attesting to
    // text the company has already replaced.
    expect(screen.getByLabelText('Language')).toBeTruthy();
    expect(screen.queryByText('मराठी')).toBeNull();
  });
});
