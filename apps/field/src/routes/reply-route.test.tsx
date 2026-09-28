import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AnalysisSchema } from '@fieldforce/core';

/**
 * FE-D2 5 — a reply that fails to SEND keeps the reply on the screen.
 *
 * The route put a send failure into the same `failure` it uses for a failed LOAD, and
 * `AnalysisReplyScreen` returns early on `failure`: the heading and a banner, nothing else. So the
 * form was replaced by a banner reading "What you wrote is still on the screen" — while what they
 * wrote was, in fact, no longer on the screen. And nothing ever reset `failure`, so there was no
 * way back to the form short of leaving.
 */

const mockGetAnalysis = jest.fn<() => Promise<unknown>>();
const mockRespond = jest.fn<(id: string, body: { response: string }) => Promise<unknown>>();
const mockReplace = jest.fn();

jest.mock('../api', () => ({
  createClientForScenario: () => ({
    getAnalysis: () => mockGetAnalysis(),
    respondToAnalysis: (id: string, body: { response: string }) => mockRespond(id, body),
  }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ analysisId: '55555555-5555-4555-8555-555555555511' }),
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

import ReplyRoute from '../../app/reply/[analysisId]';

const ANALYSIS = AnalysisSchema.parse({
  id: '55555555-5555-4555-8555-555555555511',
  visitId: '55555555-5555-4555-8555-555555555522',
  mrId: '55555555-5555-4555-8555-555555555533',
  transcriptId: '55555555-5555-4555-8555-555555555544',
  status: 'completed',
  refusalReason: null,
  rubricVersion: 'r1',
  modelProvider: 'p',
  modelVersion: 'v',
  findings: [
    {
      id: '55555555-5555-4555-8555-555555555501',
      analysisId: '55555555-5555-4555-8555-555555555511',
      category: 'objection_handling',
      severity: 'improvement',
      title: 'The cost objection was not answered.',
      detail: 'He raised cost and the conversation moved to dosing.',
      citations: [
        {
          transcriptId: '55555555-5555-4555-8555-555555555544',
          segmentId: '55555555-5555-4555-8555-5555555555cc',
          startMs: 134_000,
          endMs: 151_000,
          quotedText: '…my patients ask about cost first.',
        },
      ],
      createdAt: '2026-08-14T19:00:00+05:30',
    },
  ],
  mrViewedAt: null,
  mrResponse: null,
  mrRespondedAt: null,
  generatedAt: '2026-08-14T19:00:00+05:30',
  createdAt: '2026-08-14T19:00:00+05:30',
});

const WROTE = 'I did answer it — he moved on before I finished.';

const writeAndSend = async (): Promise<void> => {
  await render(<ReplyRoute />);
  await screen.findByText('The cost objection was not answered.');
  await fireEvent.changeText(screen.getByLabelText('What you want to say'), WROTE);
  await fireEvent.press(screen.getByText('Send reply'));
};

beforeEach(() => {
  mockGetAnalysis.mockReset();
  mockRespond.mockReset();
  mockReplace.mockReset();
  mockGetAnalysis.mockResolvedValue(ANALYSIS);
});

describe('FE-D2 5 — a send failure keeps the reply', () => {
  it('says it was not sent, and the words and the Send button are still there', async () => {
    mockRespond.mockRejectedValue(new Error('Network request failed.'));
    await writeAndSend();

    expect(await screen.findByText('Your reply was not sent')).toBeTruthy();
    // The claim the banner makes must be true on the screen it is on.
    expect(screen.getByDisplayValue(WROTE)).toBeTruthy();
    expect(screen.getByText('Send reply')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('editing the reply clears the send failure', async () => {
    mockRespond.mockRejectedValue(new Error('Network request failed.'));
    await writeAndSend();
    await screen.findByText('Your reply was not sent');

    await fireEvent.changeText(screen.getByLabelText('What you want to say'), `${WROTE} Again.`);

    expect(screen.queryByText('Your reply was not sent')).toBeNull();
  });

  it('POSITIVE CONTROL: a reply that sends goes back to the analysis, with no failure', async () => {
    mockRespond.mockResolvedValue({});
    await writeAndSend();

    expect(mockRespond).toHaveBeenCalledWith(ANALYSIS.id, { response: WROTE });
    expect(mockReplace).toHaveBeenCalledWith(`/analysis/${ANALYSIS.id}`);
    expect(screen.queryByText('Your reply was not sent')).toBeNull();
  });

  it('UNCHANGED: a failed LOAD still replaces the form — there is nothing to reply to', async () => {
    mockGetAnalysis.mockRejectedValue(new Error('Network request failed.'));
    await render(<ReplyRoute />);

    expect(await screen.findByText('Could not load the finding')).toBeTruthy();
    expect(screen.queryByText('Send reply')).toBeNull();
  });
});
