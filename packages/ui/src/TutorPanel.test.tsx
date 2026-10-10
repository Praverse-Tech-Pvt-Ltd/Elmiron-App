import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TutorPanel } from './TutorPanel';
import type { TutorPanelProps } from './TutorPanel';

const noop = (): void => undefined;
const base: TutorPanelProps = {
  question: '',
  onChangeQuestion: noop,
  onAsk: noop,
  view: { kind: 'idle' },
};

describe('TutorPanel — every state is distinct, and none pretends', () => {
  it('cannot ask an empty question', async () => {
    const onAsk = jest.fn();
    await render(<TutorPanel {...base} onAsk={onAsk} />);
    expect(screen.getByText('Write your question first.')).toBeTruthy();
  });

  it('an explanation says it came from this lesson only', async () => {
    await render(<TutorPanel {...base} view={{ kind: 'explained', text: 'Heat degrades it.' }} />);
    expect(screen.getByText('Heat degrades it.')).toBeTruthy();
    expect(screen.getByText('Explained from this lesson only.')).toBeTruthy();
  });

  it('not covered, and a patient question, are the server’s words, never an answer', async () => {
    await render(
      <TutorPanel
        {...base}
        view={{ kind: 'not_in_lesson', text: 'This lesson does not cover that.' }}
      />,
    );
    expect(screen.getByText('This lesson does not cover that.')).toBeTruthy();
    expect(screen.queryByText('Explained from this lesson only.')).toBeNull();
  });

  it('no model: not available -- never an answer', async () => {
    await render(<TutorPanel {...base} view={{ kind: 'switched_off' }} />);
    expect(screen.getByText('The tutor is not available yet.')).toBeTruthy();
  });

  it('offline: try again', async () => {
    const onRetry = jest.fn();
    await render(<TutorPanel {...base} view={{ kind: 'offline', onRetry }} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('at the limit says when more come', async () => {
    await render(
      <TutorPanel {...base} view={{ kind: 'at_limit', resetLabel: '00:00 on 10 Oct' }} />,
    );
    expect(screen.getByText('More from 00:00 on 10 Oct.')).toBeTruthy();
  });
});
