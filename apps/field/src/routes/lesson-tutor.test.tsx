import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

/**
 * The lesson tutor as wired: type, ask, see what the gateway said. The transport is injected, so the
 * request it receives is asserted exactly; `appLiveConnection` is mocked only so the default is not
 * built (it reads the app config).
 */
jest.mock('../live-connection', () => ({ appLiveConnection: () => ({}) }));

import { LessonTutor } from '../learning/lesson-tutor';

const LESSON = '55555555-5555-4555-8555-555555555555';
const zone = { timeZone: 'Asia/Kolkata', source: 'territory' } as const;

const ask = async (question: string): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText('Your question'), question);
  await fireEvent.press(screen.getByText('Ask the tutor'));
};

describe('LessonTutor', () => {
  it('asks about THIS lesson and shows the explanation', async () => {
    const transport = jest.fn((_body: unknown) =>
      Promise.resolve({
        status: 200,
        body: { kind: 'explained', explanation: 'Heat degrades it.' },
      }),
    );
    await render(<LessonTutor lessonId={LESSON} transport={transport} zone={zone} />);
    await ask('Why keep it cool?');
    expect(await screen.findByText('Heat degrades it.')).toBeTruthy();
    expect(transport).toHaveBeenCalledWith({
      feature: 'lms_tutor',
      lessonId: LESSON,
      question: 'Why keep it cool?',
    });
  });

  it('the stub is "not available yet", never an answer', async () => {
    const transport = jest.fn((_body: unknown) =>
      Promise.resolve({ status: 200, body: { kind: 'explained', explanation: '[stub] x' } }),
    );
    await render(<LessonTutor lessonId={LESSON} transport={transport} zone={zone} />);
    await ask('Why?');
    expect(await screen.findByText('The tutor is not available yet.')).toBeTruthy();
  });

  it('offline: try again sends the same question once more', async () => {
    const transport = jest
      .fn((_body: unknown) =>
        Promise.resolve({ status: 200, body: { kind: 'explained', explanation: 'Now.' } }),
      )
      .mockImplementationOnce(() => Promise.reject(new TypeError('Network request failed')));
    await render(<LessonTutor lessonId={LESSON} transport={transport} zone={zone} />);
    await ask('Why?');
    await fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByText('Now.')).toBeTruthy();
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
