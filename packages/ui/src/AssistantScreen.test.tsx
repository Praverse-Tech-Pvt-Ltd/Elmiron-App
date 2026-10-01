import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AssistantScreen } from './AssistantScreen';
import type { AssistantScreenProps } from './AssistantScreen';

const noop = (): void => undefined;

const base: AssistantScreenProps = {
  turns: [],
  draft: '',
  onChangeDraft: noop,
  onSend: noop,
  sending: false,
  notice: { kind: 'none' },
  allowance: { kind: 'not_reported' },
  sample: false,
};

const question = { id: 'q1', kind: 'question', text: 'How do I end my day?' } as const;

describe('AssistantScreen — every state is distinct', () => {
  it('empty: no conversation yet', async () => {
    await render(<AssistantScreen {...base} />);

    expect(screen.getByText('No questions yet')).toBeTruthy();
    expect(screen.queryByTestId('assistant-answer')).toBeNull();
  });

  it('sending: the question shows, and the wait is named', async () => {
    await render(<AssistantScreen {...base} sending turns={[question]} />);

    expect(screen.getByText('How do I end my day?')).toBeTruthy();
    expect(screen.getByText('Waiting for the assistant')).toBeTruthy();
    expect(screen.queryByText('No questions yet')).toBeNull();
  });

  it('answer: shown as the assistant’s answer', async () => {
    await render(
      <AssistantScreen
        {...base}
        turns={[question, { id: 'a1', kind: 'answer', text: 'Open Me, then How today ended.' }]}
      />,
    );

    expect(screen.getByTestId('assistant-answer')).toBeTruthy();
    expect(screen.getByText('Open Me, then How today ended.')).toBeTruthy();
    expect(screen.getByText('Assistant')).toBeTruthy();
  });

  it('refusal: a designed state, not an answer and not an error', async () => {
    await render(
      <AssistantScreen
        {...base}
        turns={[question, { id: 'r1', kind: 'refusal', text: 'Use Product Q&A.' }]}
      />,
    );

    expect(screen.getByTestId('assistant-refusal')).toBeTruthy();
    expect(screen.getByText('The assistant did not answer this')).toBeTruthy();
    expect(screen.getByText('Use Product Q&A.')).toBeTruthy();
    expect(screen.queryByTestId('assistant-answer')).toBeNull();
    expect(screen.queryByText('The assistant could not answer')).toBeNull();
  });

  it('not available yet: says nothing was answered, and shows no answer', async () => {
    await render(
      <AssistantScreen {...base} notice={{ kind: 'not_available' }} turns={[question]} />,
    );

    expect(screen.getByText('The assistant is not available yet')).toBeTruthy();
    expect(screen.queryByTestId('assistant-answer')).toBeNull();
  });

  it('at the limit: the warning shows and Send is disabled', async () => {
    const onSend = jest.fn();
    await render(
      <AssistantScreen
        {...base}
        allowance={{ kind: 'at_limit', resetLabel: '00:00 on 2 Oct' }}
        draft="One more"
        onSend={onSend}
      />,
    );

    expect(
      screen.getByText(
        "You have reached today's limit. The assistant is unavailable until it resets.",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('before the limit: the warning shows and Send still works', async () => {
    const onSend = jest.fn();
    await render(
      <AssistantScreen
        {...base}
        allowance={{ kind: 'warning', used: 80, limit: 100, resetLabel: null }}
        draft="Next question"
        onSend={onSend}
      />,
    );

    expect(screen.getByText("You have used 80 of today's 100 assistant requests.")).toBeTruthy();
    await fireEvent.press(screen.getByText('Send'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('offline: says the question was not sent, with a retry', async () => {
    const onRetry = jest.fn();
    await render(
      <AssistantScreen {...base} notice={{ kind: 'offline', onRetry }} turns={[question]} />,
    );

    expect(screen.getByText('You are offline')).toBeTruthy();
    await fireEvent.press(screen.getByText('Send again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('error: says it could not answer, with a retry', async () => {
    const onRetry = jest.fn();
    await render(
      <AssistantScreen {...base} notice={{ kind: 'error', onRetry }} turns={[question]} />,
    );

    expect(screen.getByText('The assistant could not answer')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('AssistantScreen — sample data is never presented as an answer', () => {
  it('labels the screen and every sample reply', async () => {
    await render(
      <AssistantScreen
        {...base}
        sample
        turns={[question, { id: 'a1', kind: 'answer', text: 'Sample answer.' }]}
      />,
    );

    expect(screen.getByText('Sample data')).toBeTruthy();
    expect(screen.getByText('Sample reply, not from the assistant')).toBeTruthy();
    expect(screen.queryByText('Assistant')).toBeNull();
  });

  it('POSITIVE CONTROL: a real answer carries no sample label', async () => {
    await render(
      <AssistantScreen {...base} turns={[question, { id: 'a1', kind: 'answer', text: 'Real.' }]} />,
    );

    expect(screen.queryByText('Sample data')).toBeNull();
    expect(screen.queryByText('Sample reply, not from the assistant')).toBeNull();
  });
});

describe('AssistantScreen — sending', () => {
  it('Send passes nothing of its own: the route sends the draft', async () => {
    const onSend = jest.fn();
    await render(<AssistantScreen {...base} draft="Hello" onSend={onSend} />);

    await fireEvent.press(screen.getByText('Send'));
    expect(onSend).toHaveBeenCalledWith();
  });

  it('an empty draft cannot be sent', async () => {
    const onSend = jest.fn();
    await render(<AssistantScreen {...base} draft="   " onSend={onSend} />);

    await fireEvent.press(screen.getByText('Send'));
    expect(onSend).not.toHaveBeenCalled();
  });
});
