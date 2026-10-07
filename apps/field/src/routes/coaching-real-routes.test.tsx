import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AnalysisSchema } from '@fieldforce/core';

/**
 * FE-D16 — Coaching, Analysis and Reply on the real functions, with the flag ON (as a test only;
 * the committed default stays off).
 *
 * The mock client is mocked to THROW, so any path back to `127.0.0.1:4010` fails these cases.
 */

const mockListMyAnalyses = jest.fn<() => Promise<unknown>>();
const mockReadMyAnalysis = jest.fn<(id: string) => Promise<unknown>>();
const mockListConsentForVisit = jest.fn<(visitId: string) => Promise<unknown>>();
const mockRespond = jest.fn<(id: string, response: string) => Promise<unknown>>();
jest.mock('../coaching/server', () => ({
  listMyAnalyses: () => mockListMyAnalyses(),
  readMyAnalysis: (id: string) => mockReadMyAnalysis(id),
  listConsentForVisit: (visitId: string) => mockListConsentForVisit(visitId),
  respondToMyAnalysis: (id: string, response: string) => mockRespond(id, response),
}));
const mockMockClient = jest.fn(() => {
  throw new Error('FE-D16: coaching must not reach the mock server');
});
jest.mock('../api', () => ({ createClientForScenario: () => mockMockClient() }));
jest.mock('../features', () => ({ coachingEnabled: true, assistantEnabled: false }));
let mockRecordingEnabled = false;
jest.mock('../coaching/recording-flag', () => ({
  loadRecordingEnabled: () => Promise.resolve(mockRecordingEnabled),
}));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({
    id: '55555555-5555-4555-8555-555555555511',
    analysisId: '55555555-5555-4555-8555-555555555511',
  }),
}));

const VISIT_ID = '55555555-5555-4555-8555-555555555501';
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({
    serverTime: '2026-10-01T09:00:00.000Z',
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    status: 'ready',
    store: {
      visit: new Map([
        [
          '55555555-5555-4555-8555-555555555501',
          {
            id: '55555555-5555-4555-8555-555555555501',
            doctorId: '55555555-5555-4555-8555-5555555555dd',
            startedAt: '2026-10-01T03:25:00+00:00',
            status: 'completed',
          },
        ],
      ]),
      doctor: new Map([
        [
          '55555555-5555-4555-8555-5555555555dd',
          { id: '55555555-5555-4555-8555-5555555555dd', fullName: 'Dr Asha Deshpande' },
        ],
      ]),
    },
  }),
}));

import Coaching from '../../app/(tabs)/coaching';
import AnalysisRoute from '../../app/analysis/[id]';
import ReplyRoute from '../../app/reply/[analysisId]';

const analysis = (over: Record<string, unknown> = {}) =>
  AnalysisSchema.parse({
    id: '55555555-5555-4555-8555-555555555511',
    visitId: VISIT_ID,
    mrId: '55555555-5555-4555-8555-5555555555aa',
    transcriptId: null,
    status: 'completed',
    refusalReason: null,
    rubricVersion: 'r1',
    modelProvider: 'fixture',
    modelVersion: 'v0',
    findings: [],
    mrViewedAt: null,
    mrResponse: null,
    mrRespondedAt: null,
    generatedAt: '2026-10-01T03:40:00+00:00',
    createdAt: '2026-10-01T03:40:00+00:00',
    ...over,
  });

beforeEach(() => {
  mockListMyAnalyses.mockReset();
  mockReadMyAnalysis.mockReset();
  mockListConsentForVisit.mockReset();
  mockRespond.mockReset();
  mockMockClient.mockClear();
  mockReplace.mockReset();
  mockRecordingEnabled = false;
  mockListConsentForVisit.mockResolvedValue({ kind: 'loaded', value: [] });
});

describe('Coaching (D1) on list_analyses', () => {
  it('with recording off and nothing to show, says coaching is not available, and why', async () => {
    mockListMyAnalyses.mockResolvedValue({ kind: 'loaded', value: [] });
    await render(<Coaching />);

    expect(await screen.findByText('Coaching is not available yet')).toBeTruthy();
    expect(screen.getByText(/Recording is off in this build/u)).toBeTruthy();
    expect(mockMockClient).not.toHaveBeenCalled();
  });

  it('with recording on and nothing yet, it is the honest empty feed', async () => {
    mockRecordingEnabled = true;
    mockListMyAnalyses.mockResolvedValue({ kind: 'loaded', value: [] });
    await render(<Coaching />);

    expect(await screen.findByText('Nothing has been reviewed yet')).toBeTruthy();
    expect(screen.queryByText('Coaching is not available yet')).toBeNull();
  });

  it('an analysis is listed under its doctor, from the pulled store, in the territory zone', async () => {
    mockListMyAnalyses.mockResolvedValue({
      kind: 'loaded',
      value: [
        analysis({
          findings: [
            {
              id: '55555555-5555-4555-8555-5555555555f1',
              analysisId: '55555555-5555-4555-8555-555555555511',
              category: 'objection_handling',
              severity: 'improvement',
              title: 'Answer the cost objection sooner.',
              detail: 'The doctor raised cost twice.',
              citations: [
                {
                  transcriptId: '55555555-5555-4555-8555-5555555555c1',
                  segmentId: '55555555-5555-4555-8555-5555555555c2',
                  startMs: 1000,
                  endMs: 4000,
                  quotedText: 'It costs too much.',
                },
              ],
              createdAt: '2026-10-01T03:40:00+00:00',
            },
          ],
        }),
      ],
    });
    await render(<Coaching />);

    expect(await screen.findByText('Dr Asha Deshpande')).toBeTruthy();
    expect(screen.getByText('1 Oct')).toBeTruthy();
    expect(screen.getByText('Written by an AI model, not by a person')).toBeTruthy();
  });

  it('a refusal is the denial state, not an empty feed', async () => {
    mockListMyAnalyses.mockResolvedValue({
      kind: 'refused',
      refusal: { code: 'not_permitted', sqlState: '42501', actionable: false },
    });
    await render(<Coaching />);

    expect(await screen.findByText('You do not have access to this coaching')).toBeTruthy();
  });

  it('a response that is not the contract is a failure, never an empty feed', async () => {
    mockListMyAnalyses.mockResolvedValue({ kind: 'mismatch', detail: 'not the shape' });
    await render(<Coaching />);

    expect(await screen.findByText('Could not load your coaching')).toBeTruthy();
    expect(screen.queryByText('Nothing has been reviewed yet')).toBeNull();
  });
});

describe('Analysis (D2) on read_analysis', () => {
  it('a completed analysis with no findings says so, and is labelled as AI-written', async () => {
    mockReadMyAnalysis.mockResolvedValue({ kind: 'loaded', value: analysis() });
    await render(<AnalysisRoute />);

    expect(await screen.findByText('No findings were returned')).toBeTruthy();
    expect(
      screen.getByText('Written by an AI model from the transcript, not by a person.'),
    ).toBeTruthy();
    expect(screen.getByText('Dr Asha Deshpande')).toBeTruthy();
    expect(mockMockClient).not.toHaveBeenCalled();
  });

  it('makes no claim about who has seen it (FE-CR-9)', async () => {
    mockReadMyAnalysis.mockResolvedValue({ kind: 'loaded', value: analysis() });
    await render(<AnalysisRoute />);
    await screen.findByText('No findings were returned');

    expect(screen.queryByText(/You read it first/u)).toBeNull();
    expect(screen.queryByText(/Your manager has not opened/u)).toBeNull();
  });

  it('an analysis that is not the MR’s (data: null) is "not available", not a blank page', async () => {
    mockReadMyAnalysis.mockResolvedValue({ kind: 'loaded', value: null });
    await render(<AnalysisRoute />);

    expect(await screen.findByText('This analysis is not available to you')).toBeTruthy();
  });
});

describe('Reply (D3) on respond_to_analysis', () => {
  it('sends the reply and goes back to the analysis', async () => {
    mockReadMyAnalysis.mockResolvedValue({ kind: 'loaded', value: analysis() });
    mockRespond.mockResolvedValue({ kind: 'sent' });
    await render(<ReplyRoute />);
    await screen.findByText(/this analysis/u);

    await fireEvent.changeText(screen.getByLabelText('What you want to say'), 'I did answer it.');
    await fireEvent.press(screen.getByText('Send reply'));

    expect(mockRespond).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555511',
      'I did answer it.',
    );
    expect(mockReplace).toHaveBeenCalledWith('/analysis/55555555-5555-4555-8555-555555555511');
    expect(mockMockClient).not.toHaveBeenCalled();
  });

  it('with no signal, says the reply was not sent and is not kept or queued, and keeps the text', async () => {
    mockReadMyAnalysis.mockResolvedValue({ kind: 'loaded', value: analysis() });
    mockRespond.mockRejectedValue(new TypeError('Network request failed'));
    await render(<ReplyRoute />);
    await screen.findByText(/this analysis/u);

    await fireEvent.changeText(screen.getByLabelText('What you want to say'), 'I did answer it.');
    await fireEvent.press(screen.getByText('Send reply'));

    expect(await screen.findByText('Your reply was not sent')).toBeTruthy();
    expect(screen.getByText(/cannot be queued/u)).toBeTruthy();
    expect(screen.getByDisplayValue('I did answer it.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
