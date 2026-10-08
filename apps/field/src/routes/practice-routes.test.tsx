import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type * as ReactModule from 'react';
import type * as UiModule from '@fieldforce/ui';
import type * as SampleModule from '../practice/sample';
import type { PracticeBackend } from '../practice/transport';
import type { TurnRequestBody } from '../practice/contract';

/**
 * FE-D17 — the AI Doctor practice routes, behind `EXPO_PUBLIC_PRACTICE` (off by default).
 *
 * W2-G A: the routes' backend is the LIVE one now (`src/practice/transport.ts`). Here it is replaced
 * by an injected fake — the sample implementation, wrapped so every turn's request can be inspected —
 * and the live backend is proved against the local stack (`sim-gateway.spec.ts`, `day-one-states.spec.ts`).
 * The pulled store holds a real doctor, so the payload test proves none of it rides along.
 */

let mockPracticeEnabled = true;
jest.mock('../features', () => ({
  get practiceEnabled() {
    return mockPracticeEnabled;
  },
  coachingEnabled: false,
  assistantEnabled: false,
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const React = jest.requireActual<typeof ReactModule>('react');
    const ui = jest.requireActual<typeof UiModule>('@fieldforce/ui');
    return React.createElement(ui.BodyText, null, `redirect:${href}`);
  },
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

const mockTurns: TurnRequestBody[] = [];
let mockStubAnalysis = false;
jest.mock('../practice/transport', () => {
  const { createSamplePracticeBackend } =
    jest.requireActual<typeof SampleModule>('../practice/sample');
  const sample: PracticeBackend = createSamplePracticeBackend();
  const backend: PracticeBackend = {
    ...sample,
    turn: (body) => {
      mockTurns.push(body);
      return sample.turn(body);
    },
    readAnalysis: async (id) => {
      const found = await sample.readAnalysis(id);
      return found === null || !mockStubAnalysis
        ? found
        : { ...found, modelProvider: 'stub', modelName: 'no-model-configured' };
    },
  };
  return { practiceBackend: backend };
});

jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    store: {
      doctor: new Map([
        [
          '55555555-5555-4555-8555-5555555555dd',
          { id: '55555555-5555-4555-8555-5555555555dd', fullName: 'Dr Asha Deshpande' },
        ],
      ]),
    },
  }),
}));

import PracticeHome from '../../app/practice/index';
import PracticeSession from '../../app/practice/session/[id]';
import PracticeAnalysis from '../../app/practice/analysis/[id]';
import { practiceBackend } from '../practice/transport';

const startSession = async (): Promise<string> => {
  const { scenarios } = await practiceBackend.listScenarios();
  return (await practiceBackend.start(scenarios[0]?.id ?? '')).sessionId;
};

beforeEach(() => {
  mockPracticeEnabled = true;
  mockStubAnalysis = false;
  mockPush.mockReset();
  mockReplace.mockReset();
  mockTurns.length = 0;
  mockParams = {};
});

describe('FE-D17 — the flag', () => {
  it('with the flag off, every practice route goes to Today', async () => {
    mockPracticeEnabled = false;
    await render(<PracticeHome />);
    expect(screen.getByText('redirect:/home')).toBeTruthy();

    mockParams = { id: 'x' };
    await render(<PracticeSession />);
    expect(screen.getByText('redirect:/home')).toBeTruthy();
    await render(<PracticeAnalysis />);
    expect(screen.getByText('redirect:/home')).toBeTruthy();
  });
});

describe('FE-D17 — home', () => {
  it('lists the backend’s scenarios — no "sample data" banner now — and starting one opens it', async () => {
    await render(<PracticeHome />);

    expect(await screen.findByText('Answer a cost objection')).toBeTruthy();
    // W2-G A: the home screen's backend is live, so a sample banner would be untrue.
    expect(screen.queryByText('Sample data')).toBeNull();
    const [first] = screen.getAllByText('Start this practice');
    if (first === undefined) throw new Error('no scenario to start');
    await fireEvent.press(first);

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringMatching(/^\/practice\/session\/[0-9a-f-]+$/u),
    );
  });
});

describe('FE-D17 — the conversation', () => {
  it('a turn sends only the session context and what the rep typed, never the store', async () => {
    mockParams = { id: await startSession() };
    await render(<PracticeSession />);
    await screen.findByText('Dr Sample Rao');

    await fireEvent.changeText(screen.getByLabelText('What you say'), 'Good morning, Doctor.');
    await fireEvent.press(screen.getByText('Send'));

    expect(await screen.findByText(/^Sample reply from the practice doctor/u)).toBeTruthy();
    expect(mockTurns).toHaveLength(1);
    const sent = JSON.stringify(mockTurns[0]);
    expect(mockTurns[0]?.repText).toBe('Good morning, Doctor.');
    expect(sent).not.toMatch(/Asha|Deshpande|55555555-5555-4555-8555-5555555555dd/u);
    expect(sent).not.toMatch(/patientId|visitId|doctorId/u);
  });

  it('no model connected is "not available", and no reply is shown', async () => {
    mockParams = { id: await startSession() };
    await render(<PracticeSession />);
    await screen.findByText('Dr Sample Rao');

    await fireEvent.changeText(screen.getByLabelText('What you say'), 'unavailable');
    await fireEvent.press(screen.getByText('Send'));

    expect(await screen.findByText('AI Doctor practice is not available yet')).toBeTruthy();
    expect(screen.queryByText(/turn 2/u)).toBeNull();
  });

  it('ending the practice and asking for feedback opens the analysis', async () => {
    mockParams = { id: await startSession() };
    await render(<PracticeSession />);
    await screen.findByText('Dr Sample Rao');
    await fireEvent.changeText(screen.getByLabelText('What you say'), 'Good morning, Doctor.');
    await fireEvent.press(screen.getByText('Send'));
    await screen.findByText(/^Sample reply/u);

    await fireEvent.press(screen.getByText('End the practice'));
    await fireEvent.press(await screen.findByText('Get my feedback'));

    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringMatching(/^\/practice\/analysis\/[0-9a-f-]+$/u),
    );
  });
});

describe('FE-D17 — the feedback', () => {
  const analysed = async (): Promise<string> => {
    const sessionId = await startSession();
    const session = await practiceBackend.readSession(sessionId);
    if (session === null) throw new Error('no session');
    await practiceBackend.turn({
      feature: 'ai_doctor',
      sessionId,
      repText: 'Good morning.',
      personaBrief: session.personaBrief,
      personaStance: session.personaStance,
      objection: session.objection,
      history: [],
    });
    await practiceBackend.end(sessionId);
    const ended = await practiceBackend.readSession(sessionId);
    if (ended === null) throw new Error('no session');
    const result = await practiceBackend.analyse({
      feature: 'ai_coach',
      sessionId,
      objective: ended.objective,
      objection: ended.objection,
      turns: ended.turns,
    });
    return (result.body as { analysisId: string }).analysisId;
  };

  it('shows the seven dimensions in the operator’s words, findings citing turns, and the labels', async () => {
    mockParams = { id: await analysed() };
    await render(<PracticeAnalysis />);

    expect(await screen.findByText('Objection handling')).toBeTruthy();
    for (const label of [
      'Opening and pitch',
      'Product knowledge',
      'Scientific accuracy',
      'Relevance of responses',
      'Communication quality',
      'Closing and follow-up',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Communication quality · Turn 1')).toBeTruthy();
    expect(screen.getByText('Handling cost objections')).toBeTruthy();
    expect(screen.getByText('Sample data')).toBeTruthy();
    expect(screen.getByText(/Your manager does not see/u)).toBeTruthy();
  });

  it('a stub analysis is "not available": its zeros are never shown as scores', async () => {
    mockStubAnalysis = true;
    mockParams = { id: await analysed() };
    await render(<PracticeAnalysis />);

    expect(await screen.findByText('Feedback is not available yet')).toBeTruthy();
    expect(screen.queryByText(/\/ 100/u)).toBeNull();
  });

  it('an analysis that does not exist is "not available to you"', async () => {
    mockParams = { id: '00000000-0000-4000-8000-000000000000' };
    await render(<PracticeAnalysis />);

    expect(await screen.findByText('This feedback is not available to you')).toBeTruthy();
  });
});
