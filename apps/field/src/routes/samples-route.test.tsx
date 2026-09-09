import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApiRequestError, DoctorSchema, VisitSchema } from '@fieldforce/core';

const mockListVisits = jest.fn<() => Promise<unknown>>();
const mockListDoctors = jest.fn<() => Promise<unknown>>();
const mockCreateSampleAndInput = jest.fn<(body: unknown) => Promise<unknown>>();
jest.mock('../api', () => ({
  createClientForScenario: () => ({
    listVisits: mockListVisits,
    listDoctors: mockListDoctors,
    createSampleAndInput: mockCreateSampleAndInput,
  }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ visitId: '22222222-2222-4222-8222-222222222201' }),
}));

import SamplesRoute from '../../app/samples/[visitId]';

const visit = VisitSchema.parse({
  id: '22222222-2222-4222-8222-222222222201',
  mrId: '22222222-2222-4222-8222-2222222222aa',
  doctorId: '22222222-2222-4222-8222-2222222222bb',
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
  id: '22222222-2222-4222-8222-2222222222bb',
  fullName: 'Dr. S. Iyer',
  registrationNumber: null,
  specialty: 'Urologist',
  qualification: null,
  territoryId: '22222222-2222-4222-8222-2222222222cc',
  assignedMrId: null,
  clinicAddresses: [],
  isActive: true,
  createdAt: '2026-08-01T08:00:00+05:30',
  updatedAt: '2026-08-01T08:00:00+05:30',
});

const loaded = () => {
  mockListVisits.mockResolvedValue({ items: [visit] });
  mockListDoctors.mockResolvedValue({ items: [doctor] });
};

describe('app/samples/[visitId].tsx — C5', () => {
  it('opens on the doctor being visited, with one empty line ready', async () => {
    loaded();
    await render(<SamplesRoute />);
    expect(await screen.findByText(/Dr\. S\. Iyer/u)).toBeTruthy();
    // One line, so no removal is offered yet.
    expect(screen.queryByText('Remove this item')).toBeNull();
  });

  it('refuses to send a line with no declared value, and says what is missing', async () => {
    // The screen's hardest rule: a zero here would be a false declaration in an
    // append-only, audit-triggered table, so an empty field stops the send rather
    // than defaulting.
    loaded();
    mockCreateSampleAndInput.mockClear();
    await render(<SamplesRoute />);
    await screen.findByText(/Dr\. S\. Iyer/u);

    await fireEvent.changeText(screen.getByLabelText('What you left'), 'Elmiron 100 mg, 30s');
    await fireEvent.press(screen.getByText('Record what I left'));

    expect(mockCreateSampleAndInput).not.toHaveBeenCalled();
    expect(screen.getByText(/declared value of one pack in rupees/u)).toBeTruthy();
  });

  it('sends a complete line as a contract request and clears the screen', async () => {
    loaded();
    mockCreateSampleAndInput.mockClear();
    mockCreateSampleAndInput.mockResolvedValue({});
    await render(<SamplesRoute />);
    await screen.findByText(/Dr\. S\. Iyer/u);

    await fireEvent.changeText(screen.getByLabelText('What you left'), 'Elmiron 100 mg, 30s');
    await fireEvent.changeText(screen.getByLabelText('Declared value, ₹ each'), '240');
    await fireEvent.press(screen.getByLabelText('One more Packs'));
    await fireEvent.press(screen.getByText('Record what I left'));

    expect(await screen.findByText('Recorded')).toBeTruthy();
    expect(mockCreateSampleAndInput).toHaveBeenCalledTimes(1);
    expect(mockCreateSampleAndInput).toHaveBeenCalledWith(
      expect.objectContaining({
        visitId: visit.id,
        doctorId: doctor.id,
        kind: 'sample',
        itemName: 'Elmiron 100 mg, 30s',
        quantity: 2,
        declaredValueInr: 240,
      }),
    );
  });

  it('keeps a refused line on screen carrying the server’s own words', async () => {
    // A refusal is a verdict, not a failure to send. The line stays put so the MR
    // can correct it; nothing is queued, because the server already has it.
    loaded();
    mockCreateSampleAndInput.mockClear();
    mockCreateSampleAndInput.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'validation_failed',
        message: 'This visit is already closed.',
        requestId: 'req-1',
        fieldErrors: null,
      }),
    );
    await render(<SamplesRoute />);
    await screen.findByText(/Dr\. S\. Iyer/u);

    await fireEvent.changeText(screen.getByLabelText('What you left'), 'Elmiron 100 mg, 30s');
    await fireEvent.changeText(screen.getByLabelText('Declared value, ₹ each'), '240');
    await fireEvent.press(screen.getByText('Record what I left'));

    expect(await screen.findByText('This visit is already closed.')).toBeTruthy();
    expect(screen.queryByText('Recorded')).toBeNull();
  });
});
