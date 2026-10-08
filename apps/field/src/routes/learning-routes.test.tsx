import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BodyText as mockBodyText } from '@fieldforce/ui';
import { LiveRequestError } from '../live-rest';
import type { LearningBackend } from '../learning/live';
import type * as ReactModule from 'react';

/**
 * W2-F B — the three learning routes, with the backend injected (the live one is proved end to end in
 * `services/api/tests/learning-screen.spec.ts`). What matters: every line is what the server said, a
 * finish is shown only with the server's stamp, and no signal is never drawn as a tick.
 */
const mockPush = jest.fn();
jest.mock('../live-connection', () => ({ appLiveConnection: () => ({}) }));
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({ zone: { timeZone: 'Asia/Kolkata', source: 'territory' } }),
}));
/** The latest focus callback, so a test can bring the screen back into view, as Back does. */
let mockFocused: (() => void) | null = null;
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  return {
    Redirect: ({ href }: { href: string }) => mockBodyText({ children: `redirect:${href}` }),
    useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: (callback: React.EffectCallback) => {
      mockFocused = () => {
        callback();
      };
      React.useEffect(callback, [callback]);
    },
  };
});

import LearningRoute, { LearningList } from '../../app/learning/index';
import { Course } from '../../app/learning/[courseId]';
import { Lesson } from '../../app/learning/lesson/[lessonId]';

const V = {
  id: 'v1',
  courseId: 'c1',
  versionNumber: 1,
  title: 'Storage basics',
  summary: null,
  status: 'published' as const,
  marketName: null,
};
const OFFLINE = new TypeError('Network request failed');

const backendWith = (over: Partial<LearningBackend>): LearningBackend => ({
  myCourses: jest.fn(async () =>
    Promise.resolve({ assignments: [], versions: [], enrolments: [] }),
  ),
  course: jest.fn(async () => Promise.resolve({ title: null, versions: [], enrolments: [] })),
  outline: jest.fn(async () =>
    Promise.resolve({ modules: [], lessons: [], completedLessonIds: new Set<string>() }),
  ),
  lesson: jest.fn(async () => Promise.resolve(null)),
  start: jest.fn(async () => Promise.reject(new Error('not expected'))),
  complete: jest.fn(async () => Promise.reject(new Error('not expected'))),
  ...over,
});

describe('app/learning — W2-F B', () => {
  it('the list: each assigned course with a line true of the server, and its due date', async () => {
    const backend = backendWith({
      myCourses: jest.fn(async () =>
        Promise.resolve({
          assignments: [
            { id: 'a1', courseId: 'c1', courseTitle: 'Storage basics', dueOn: '2026-10-15' },
            { id: 'a2', courseId: 'c2', courseTitle: 'Objections', dueOn: null },
          ],
          versions: [V, { ...V, id: 'v2', courseId: 'c2', title: 'Objections' }],
          enrolments: [
            {
              id: 'e2',
              versionId: 'v2',
              startedAt: '2026-10-06T04:00:00+00:00',
              completedAt: '2026-10-07T09:10:00+00:00',
            },
          ],
        }),
      ),
    });
    await render(<LearningList backend={backend} />);
    expect(await screen.findByText('Not started · Due 15 Oct')).toBeTruthy();
    expect(screen.getByText('Finished 7 Oct')).toBeTruthy();
    await fireEvent.press(screen.getByText('Storage basics'));
    expect(mockPush).toHaveBeenCalledWith('/learning/c1');
  });

  it('W2-G D (found on the emulator): coming BACK to the list reads the server again', async () => {
    let finished = false;
    const myCourses = jest.fn(async () =>
      Promise.resolve({
        assignments: [{ id: 'a1', courseId: 'c1', courseTitle: 'Storage basics', dueOn: null }],
        versions: [V],
        enrolments: finished
          ? [
              {
                id: 'e1',
                versionId: 'v1',
                startedAt: '2026-10-07T09:00:00+00:00',
                completedAt: '2026-10-07T09:10:00+00:00',
              },
            ]
          : [],
      }),
    );
    await render(<LearningList backend={backendWith({ myCourses })} />);
    expect(await screen.findByText('Not started')).toBeTruthy();
    // The rep finishes the course elsewhere, then comes back: the screen is focused again.
    finished = true;
    await act(() => {
      mockFocused?.();
    });
    expect(await screen.findByText('Finished 7 Oct')).toBeTruthy();
    expect(screen.queryByText('Not started')).toBeNull();
    expect(myCourses).toHaveBeenCalledTimes(2);
  });

  it('nothing assigned: said plainly', async () => {
    await render(<LearningList backend={backendWith({})} />);
    expect(await screen.findByText('No course has been assigned to you.')).toBeTruthy();
  });

  it('no signal: says so, offers a retry, and the retry asks again', async () => {
    const myCourses = jest.fn(async () => Promise.reject(OFFLINE));
    await render(<LearningList backend={backendWith({ myCourses })} />);
    expect(await screen.findByText('No signal, so your courses could not be loaded.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(myCourses).toHaveBeenCalledTimes(2);
  });

  it('a course not started: "Start this course" starts THAT version, then shows its lessons', async () => {
    let started = false;
    const start = jest.fn(async () => {
      started = true;
      return Promise.resolve({
        id: 'e1',
        courseVersionId: 'v1',
        startedAt: '2026-10-07T09:00:00+00:00',
        completedAt: null,
      });
    });
    const backend = backendWith({
      course: jest.fn(async () =>
        Promise.resolve({
          title: 'Storage basics',
          versions: [V],
          enrolments: started
            ? [
                {
                  id: 'e1',
                  versionId: 'v1',
                  startedAt: '2026-10-07T09:00:00+00:00',
                  completedAt: null,
                },
              ]
            : [],
        }),
      ),
      outline: jest.fn(async () =>
        Promise.resolve({
          modules: [{ id: 'm1', position: 1, title: 'Keeping stock' }],
          lessons: [
            { id: 'l1', moduleId: 'm1', position: 1, title: 'Cold chain', estimatedMinutes: 5 },
            { id: 'l2', moduleId: 'm1', position: 2, title: 'Shelf life', estimatedMinutes: null },
          ],
          completedLessonIds: new Set(['l1']),
        }),
      ),
      start,
    });
    await render(<Course backend={backend} courseId="c1" />);
    await fireEvent.press(await screen.findByText('Start this course'));
    expect(start).toHaveBeenCalledWith('v1');
    expect(await screen.findByText('1 of 2 lessons finished')).toBeTruthy();
    expect(screen.getByText('Finished · about 5 min')).toBeTruthy();
    expect(screen.getByText('Not finished')).toBeTruthy();
    await fireEvent.press(screen.getByText('Shelf life'));
    expect(mockPush).toHaveBeenCalledWith('/learning/lesson/l2?enrolment=e1');
  });

  it('a start that got no answer: the course is NOT shown as started', async () => {
    const backend = backendWith({
      course: jest.fn(async () =>
        Promise.resolve({ title: 'Storage basics', versions: [V], enrolments: [] }),
      ),
      start: jest.fn(async () => Promise.reject(OFFLINE)),
    });
    await render(<Course backend={backend} courseId="c1" />);
    await fireEvent.press(await screen.findByText('Start this course'));
    expect(
      await screen.findByText(
        'No signal, so the course was not started. Try again when you have signal.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/lessons finished/u)).toBeNull();
  });

  const lessonBackend = (complete: LearningBackend['complete']) =>
    backendWith({
      lesson: jest.fn(async () =>
        Promise.resolve({
          id: 'l1',
          versionId: 'v1',
          title: 'Cold chain',
          body: 'Keep below 25 °C.',
          estimatedMinutes: 5,
          completedAt: null,
        }),
      ),
      complete,
    });

  it('finishing a lesson: the SERVER’s stamp and counts, in the territory’s clock', async () => {
    const complete = jest.fn(async () =>
      Promise.resolve({
        enrolmentId: 'e1',
        lessonId: 'l1',
        lessonCompletedAt: '2026-10-07T09:10:00+00:00',
        lessonsCompleted: 1,
        lessonsTotal: 2,
        courseCompletedAt: null,
      }),
    );
    await render(<Lesson backend={lessonBackend(complete)} enrolmentId="e1" lessonId="l1" />);
    expect(await screen.findByText('Keep below 25 °C.')).toBeTruthy();
    expect(screen.getByText('About 5 minutes')).toBeTruthy();
    await fireEvent.press(screen.getByText('I have finished this lesson'));
    expect(complete).toHaveBeenCalledWith('e1', 'l1');
    // 09:10 UTC is 14:40 in Asia/Kolkata.
    expect(await screen.findByText('Finished — recorded 14:40 on 7 Oct.')).toBeTruthy();
    expect(screen.getByText('1 of 2 lessons finished.')).toBeTruthy();
  });

  it('finishing with no signal: NOTHING recorded is claimed, and the button stays', async () => {
    await render(
      <Lesson
        backend={lessonBackend(jest.fn(async () => Promise.reject(OFFLINE)))}
        enrolmentId="e1"
        lessonId="l1"
      />,
    );
    await fireEvent.press(await screen.findByText('I have finished this lesson'));
    expect(await screen.findByText(/No signal, so this was not recorded/u)).toBeTruthy();
    expect(screen.queryByText(/Finished — recorded/u)).toBeNull();
    expect(screen.getByText('I have finished this lesson')).toBeTruthy();
  });

  it('a refused finish says the server did not record it — not "no signal"', async () => {
    await render(
      <Lesson
        backend={lessonBackend(
          jest.fn(async () => Promise.reject(new LiveRequestError(403, '42501', 'not yours'))),
        )}
        enrolmentId="e1"
        lessonId="l1"
      />,
    );
    await fireEvent.press(await screen.findByText('I have finished this lesson'));
    expect(await screen.findByText(/The server did not record this lesson/u)).toBeTruthy();
    expect(screen.queryByText(/No signal/u)).toBeNull();
  });

  it('with the flag OFF (the default), the route goes to Today', async () => {
    await render(<LearningRoute />);
    expect(screen.getByText('redirect:/home')).toBeTruthy();
  });
});
