import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PracticeAnalysisScreen } from './PracticeAnalysisScreen';
import { PracticeHomeScreen } from './PracticeHomeScreen';
import { PracticeSessionScreen } from './PracticeSessionScreen';

/**
 * FE-D17 — AI Doctor practice: the home (pick a scenario, see past sessions), the conversation,
 * and the analysis. No design exists in `docs/design/` for these; they use existing components.
 */

const noop = (): void => undefined;

const scenario = {
  id: 's1',
  title: 'Answer a cost objection',
  personaLine: 'Dr Sample Rao · Urology · sceptical',
  objective: 'Introduce the product and agree a follow-up visit.',
  objection: 'The price is too high for my patients.',
};

describe('PracticeHomeScreen', () => {
  const base = {
    sample: false,
    scenarios: [scenario],
    sessions: [],
    onStart: noop,
    onOpenSession: noop,
    onOpenAnalysis: noop,
  };

  it('lists scenarios to start, and starting one passes its id', async () => {
    const onStart = jest.fn();
    await render(<PracticeHomeScreen {...base} onStart={onStart} />);

    expect(screen.getByText('Answer a cost objection')).toBeTruthy();
    expect(screen.getByText('Dr Sample Rao · Urology · sceptical')).toBeTruthy();
    await fireEvent.press(screen.getByText('Start this practice'));
    expect(onStart).toHaveBeenCalledWith('s1');
  });

  it('no scenarios yet is its own state, and says why', async () => {
    await render(<PracticeHomeScreen {...base} scenarios={[]} />);

    expect(screen.getByText('No practice scenarios yet')).toBeTruthy();
  });

  it('no sessions yet is its own state', async () => {
    await render(<PracticeHomeScreen {...base} />);

    expect(screen.getByText('No practice sessions yet')).toBeTruthy();
  });

  it('a past session opens its feedback when it has one', async () => {
    const onOpenAnalysis = jest.fn();
    await render(
      <PracticeHomeScreen
        {...base}
        onOpenAnalysis={onOpenAnalysis}
        sessions={[
          {
            sessionId: 'x1',
            title: 'Answer a cost objection',
            personaName: 'Dr Sample Rao',
            stateLabel: 'Feedback ready',
            analysisId: 'a1',
          },
        ]}
      />,
    );

    await fireEvent.press(screen.getByText('See the feedback'));
    expect(onOpenAnalysis).toHaveBeenCalledWith('a1');
  });

  it('loading and failure are distinct states', async () => {
    await render(<PracticeHomeScreen {...base} loading scenarios={[]} />);
    expect(screen.getByText('Getting your practice')).toBeTruthy();
    expect(screen.queryByText('No practice scenarios yet')).toBeNull();

    await render(
      <PracticeHomeScreen
        {...base}
        failure={{ title: 'Could not load practice', detail: 'x' }}
        scenarios={[]}
      />,
    );
    expect(screen.getByText('Could not load practice')).toBeTruthy();
  });

  it('labels sample data', async () => {
    await render(<PracticeHomeScreen {...base} sample />);
    expect(screen.getByText('Sample data')).toBeTruthy();
  });
});

describe('PracticeSessionScreen', () => {
  const base = {
    sample: false,
    personaName: 'Dr Sample Rao',
    personaLine: 'Urology · sceptical',
    objective: 'Introduce the product and agree a follow-up visit.',
    objection: 'The price is too high for my patients.',
    turns: [
      { turnIndex: 1, role: 'rep' as const, text: 'Good morning, Doctor.' },
      { turnIndex: 2, role: 'doctor' as const, text: 'Go on.' },
    ],
    draft: '',
    onChangeDraft: noop,
    onSend: noop,
    sending: false,
    phase: 'open' as const,
    onEnd: noop,
    onGetFeedback: noop,
    busy: false,
    notice: { kind: 'none' } as const,
    allowance: { kind: 'not_reported' } as const,
  };

  it('shows the conversation, numbered, with the doctor marked as an AI practice doctor', async () => {
    await render(<PracticeSessionScreen {...base} />);

    expect(screen.getByText('You · turn 1')).toBeTruthy();
    expect(screen.getByText('Dr Sample Rao, AI practice doctor · turn 2')).toBeTruthy();
    expect(screen.getByText('The price is too high for my patients.')).toBeTruthy();
  });

  it('a refusal (patient details) is a designed state, not an error', async () => {
    await render(
      <PracticeSessionScreen
        {...base}
        notice={{ kind: 'refused', message: 'No patients here.' }}
      />,
    );

    expect(screen.getByText('The practice doctor did not answer this')).toBeTruthy();
    expect(screen.queryByText('The practice doctor could not answer')).toBeNull();
  });

  it('not available, offline and error are each distinct', async () => {
    await render(<PracticeSessionScreen {...base} notice={{ kind: 'not_available' }} />);
    expect(screen.getByText('AI Doctor practice is not available yet')).toBeTruthy();

    const onRetry = jest.fn();
    await render(<PracticeSessionScreen {...base} notice={{ kind: 'offline', onRetry }} />);
    await fireEvent.press(screen.getByText('Send again'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await render(<PracticeSessionScreen {...base} notice={{ kind: 'error', onRetry }} />);
    expect(screen.getByText('The practice doctor could not answer')).toBeTruthy();
  });

  it('ending the session offers feedback instead of another turn', async () => {
    const onGetFeedback = jest.fn();
    await render(<PracticeSessionScreen {...base} onGetFeedback={onGetFeedback} phase="ended" />);

    expect(screen.queryByText('Send')).toBeNull();
    await fireEvent.press(screen.getByText('Get my feedback'));
    expect(onGetFeedback).toHaveBeenCalledTimes(1);
  });

  it('at the daily limit, Send is off', async () => {
    const onSend = jest.fn();
    await render(
      <PracticeSessionScreen
        {...base}
        allowance={{ kind: 'at_limit', resetLabel: null }}
        draft="One more"
        onSend={onSend}
      />,
    );

    await fireEvent.press(screen.getByText('Send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('labels sample data', async () => {
    await render(<PracticeSessionScreen {...base} sample />);
    expect(screen.getByText('Sample data')).toBeTruthy();
  });
});

describe('PracticeAnalysisScreen', () => {
  const base = {
    sample: false,
    title: 'Answer a cost objection',
    personaName: 'Dr Sample Rao',
    overallLabel: '58 / 100',
    dimensions: [
      { key: 'opening', label: 'Opening and pitch', scoreLabel: '64 / 100' },
      { key: 'objection_handling', label: 'Objection handling', scoreLabel: '42 / 100' },
    ],
    strengths: [
      {
        id: 's1',
        title: 'A clear opening',
        detail: 'You named the purpose first.',
        dimensionLabel: 'Communication quality',
        turnLabel: 'Turn 1',
      },
    ],
    improvements: [
      {
        id: 'i1',
        title: 'Answer the cost objection directly',
        detail: 'You moved on to dosing.',
        dimensionLabel: 'Objection handling',
        turnLabel: 'Turn 3',
      },
    ],
    modules: [{ id: 'm1', title: 'Handling cost objections', reason: 'For objections.' }],
    summary: 'A solid start.',
  };

  it('shows the seven-dimension shape: overall, each dimension, findings citing turns, modules', async () => {
    await render(<PracticeAnalysisScreen {...base} />);

    expect(screen.getByText('58 / 100')).toBeTruthy();
    expect(screen.getByText('Objection handling')).toBeTruthy();
    expect(screen.getByText('42 / 100')).toBeTruthy();
    expect(screen.getByText('A clear opening')).toBeTruthy();
    expect(screen.getByText('Communication quality · Turn 1')).toBeTruthy();
    expect(screen.getByText('Answer the cost objection directly')).toBeTruthy();
    expect(screen.getByText('Handling cost objections')).toBeTruthy();
  });

  it('says it is AI-written, and who can see it', async () => {
    await render(<PracticeAnalysisScreen {...base} />);

    expect(
      screen.getByText('Written by an AI model from your practice conversation, not by a person.'),
    ).toBeTruthy();
    expect(screen.getByText(/Your manager does not see/u)).toBeTruthy();
  });

  it('no model connected: says feedback is not available, and shows no scores', async () => {
    await render(<PracticeAnalysisScreen {...base} notAvailable />);

    expect(screen.getByText('Feedback is not available yet')).toBeTruthy();
    expect(screen.queryByText('58 / 100')).toBeNull();
  });

  it('labels sample data on the scores', async () => {
    await render(<PracticeAnalysisScreen {...base} sample />);

    expect(screen.getByText('Sample data')).toBeTruthy();
    expect(screen.getByText(/sample values/u)).toBeTruthy();
  });

  it('loading and failure are distinct', async () => {
    await render(<PracticeAnalysisScreen {...base} loading />);
    expect(screen.getByText('Getting your feedback')).toBeTruthy();
    expect(screen.queryByText('58 / 100')).toBeNull();

    await render(
      <PracticeAnalysisScreen
        {...base}
        failure={{ title: 'Could not load feedback', detail: 'x' }}
      />,
    );
    expect(screen.getByText('Could not load feedback')).toBeTruthy();
  });
});
