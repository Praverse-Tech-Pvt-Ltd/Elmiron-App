import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { CourseScreen, LessonBody, LessonScreen } from './LearningScreens';

const noop = (): void => undefined;

describe('LearningScreens — W2-F B', () => {
  it('several markets: the rep is told why there is a choice, and each choice names its market', async () => {
    const onIndia = jest.fn();
    await render(
      <CourseScreen
        view={{
          kind: 'can_start',
          title: 'Storage basics',
          starting: false,
          notice: null,
          choices: [
            { label: 'Storage basics — India', onStart: onIndia },
            { label: 'Storage basics — not specific to a market', onStart: noop },
          ],
        }}
      />,
    );
    expect(screen.getByText(/version for more than one market/u)).toBeTruthy();
    await fireEvent.press(screen.getByText('Start: Storage basics — India'));
    expect(onIndia).toHaveBeenCalledTimes(1);
  });

  it('POSITIVE CONTROL: one version — no market prompt, just "Start this course"', async () => {
    await render(
      <CourseScreen
        view={{
          kind: 'can_start',
          title: 'Storage basics',
          starting: false,
          notice: null,
          choices: [{ label: 'Storage basics', onStart: noop }],
        }}
      />,
    );
    expect(screen.getByText('Start this course')).toBeTruthy();
    expect(screen.queryByText(/more than one market/u)).toBeNull();
  });

  it('nothing published: says there is nothing to start, and offers no button', async () => {
    await render(<CourseScreen view={{ kind: 'nothing_published', title: 'Storage basics' }} />);
    expect(screen.getByText(/nothing to start/u)).toBeTruthy();
    expect(screen.queryByText(/Start/u)).toBeNull();
  });

  it('a course reads finished only with the server’s stamp; otherwise its counts', async () => {
    const outline = {
      kind: 'outline' as const,
      title: 'Storage basics',
      done: 2,
      total: 2,
      sections: [],
    };
    const { rerender } = await render(<CourseScreen view={{ ...outline, finished: null }} />);
    expect(screen.getByText('2 of 2 lessons finished')).toBeTruthy();
    expect(screen.queryByText(/Course finished/u)).toBeNull();
    await rerender(<CourseScreen view={{ ...outline, finished: '7 Oct' }} />);
    expect(screen.getByText('Course finished 7 Oct')).toBeTruthy();
  });

  it('a lesson shows "Finished" only with a stamp; without one, the button', async () => {
    const reading = {
      kind: 'reading' as const,
      title: 'Cold chain',
      body: 'Keep below 25 °C.',
      minutes: null,
      recording: false,
      onFinish: noop,
      notice: null,
    };
    const { rerender } = await render(<LessonScreen view={{ ...reading, finished: null }} />);
    expect(screen.getByText('I have finished this lesson')).toBeTruthy();
    expect(screen.queryByText(/Finished —/u)).toBeNull();
    await rerender(<LessonScreen view={{ ...reading, finished: '14:40 on 7 Oct' }} />);
    expect(screen.getByText('Finished — recorded 14:40 on 7 Oct.')).toBeTruthy();
    expect(screen.queryByText('I have finished this lesson')).toBeNull();
  });
});

describe('UX polish — a lesson reads as the author wrote it', () => {
  it('splits paragraphs, renders a heading and bullets, and drops nothing', async () => {
    await render(
      <LessonBody
        body={'Opening paragraph.\n\n# Dosing\n\n- Take with food\n- Once daily\n\nClosing.'}
      />,
    );
    expect(screen.getByText('Opening paragraph.')).toBeTruthy();
    expect(screen.getByText('Dosing')).toBeTruthy();
    expect(screen.getByText('•  Take with food')).toBeTruthy();
    expect(screen.getByText('•  Once daily')).toBeTruthy();
    expect(screen.getByText('Closing.')).toBeTruthy();
  });

  it('a body with no blank lines is one paragraph, exactly as before', async () => {
    await render(<LessonBody body={'One line.\nAnother line.'} />);
    expect(screen.getByText('One line.\nAnother line.')).toBeTruthy();
  });
});
