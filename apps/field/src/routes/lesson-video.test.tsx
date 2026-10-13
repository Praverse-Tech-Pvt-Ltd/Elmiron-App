import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { LiveRequestError } from '../live-rest';
import type { LearningBackend, LessonRow } from '../learning/live';

/**
 * `FE-W127` — a lesson's video, in the lesson screen, with `expo-video` mocked (the player is native;
 * what matters here is what the rep is shown and what is asked of the server, and when). The signed
 * URL itself is proved against the real stack, as the rep and as another company's rep, in
 * `services/api/tests/lesson-videos.spec.ts`.
 */
const mockPlay = jest.fn();
/** The props the player was drawn with, so a test can read them (the mock renders nothing). */
const mockViewProps: Record<string, unknown>[] = [];
let mockStatus = 'readyToPlay';
jest.mock('expo-video', () => ({
  VideoView: (props: Record<string, unknown>) => {
    mockViewProps.push(props);
    return null;
  },
  useVideoPlayer: (_uri: string, setup?: (p: { play: () => void }) => void) => {
    const player = { play: mockPlay, status: 'idle' };
    setup?.(player);
    return player;
  },
}));
jest.mock('expo', () => ({
  ...jest.requireActual<Record<string, unknown>>('expo'),
  useEvent: () => ({ status: mockStatus }),
}));
jest.mock('../live-connection', () => ({ appLiveConnection: () => ({}) }));
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({ zone: { timeZone: 'Asia/Kolkata', source: 'territory' } }),
}));
jest.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

import { Lesson } from '../../app/learning/lesson/[lessonId]';

const OFFLINE = new TypeError('Network request failed');
const CLIP = 'o/v/l/video-ab12.mp4';
const POSTER = 'o/v/l/poster-cd34.jpg';

const LESSON: LessonRow = {
  id: 'l1',
  versionId: 'v1',
  title: 'Phenotyping IC/BPS',
  body: 'Read the four phenotypes.',
  estimatedMinutes: 6,
  completedAt: null,
  video: { objectPath: CLIP, posterPath: POSTER, durationSeconds: 125 },
};

const backendWith = (
  videoUrl: LearningBackend['videoUrl'],
  lesson: LessonRow = LESSON,
): LearningBackend => ({
  myCourses: jest.fn(async () => Promise.reject(new Error('not expected'))),
  course: jest.fn(async () => Promise.reject(new Error('not expected'))),
  outline: jest.fn(async () => Promise.reject(new Error('not expected'))),
  lesson: jest.fn(async () => Promise.resolve(lesson)),
  start: jest.fn(async () => Promise.reject(new Error('not expected'))),
  complete: jest.fn(async () => Promise.reject(new Error('not expected'))),
  videoUrl,
});

const signed = (path: string) => `https://example.test/storage/v1/object/sign/${path}?token=t`;

beforeEach(() => {
  mockPlay.mockClear();
  mockViewProps.length = 0;
  mockStatus = 'readyToPlay';
});

describe('a lesson with a video (FE-W127)', () => {
  it('poster first: only the poster is signed until the rep presses play, then the clip plays in place', async () => {
    const videoUrl = jest.fn(async (path: string) => Promise.resolve(signed(path)));
    await render(<Lesson backend={backendWith(videoUrl)} enrolmentId="e1" lessonId="l1" />);
    const play = await screen.findByLabelText('Play the lesson video, 2:05 long');
    expect(screen.getByText('Video · 2:05')).toBeTruthy();
    // The text is there with it, and so is the one primary action.
    expect(screen.getByText('Read the four phenotypes.')).toBeTruthy();
    expect(screen.getByText('I have finished this lesson')).toBeTruthy();
    expect(videoUrl.mock.calls.map((c) => c[0])).toEqual([POSTER]);
    expect(mockPlay).not.toHaveBeenCalled();

    await fireEvent.press(play);
    expect(await screen.findByTestId('lesson-video-player')).toBeTruthy();
    // Native controls and full screen; never picture-in-picture.
    expect(mockViewProps.at(-1)).toMatchObject({
      nativeControls: true,
      fullscreenOptions: { enable: true },
      allowsPictureInPicture: false,
    });
    expect(videoUrl.mock.calls.map((c) => c[0])).toEqual([POSTER, CLIP]);
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it('no signal: one calm line that the video needs a connection, and the text still reads', async () => {
    const videoUrl = jest.fn(async () => Promise.reject(OFFLINE));
    await render(<Lesson backend={backendWith(videoUrl)} enrolmentId="e1" lessonId="l1" />);
    expect(await screen.findByText(/This video needs a connection to play/u)).toBeTruthy();
    expect(screen.getByText('Read the four phenotypes.')).toBeTruthy();
    expect(screen.getByText('I have finished this lesson')).toBeTruthy();
    expect(screen.queryByText(/did not load/u)).toBeNull();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('a refusal says "did not load", and Try again asks the server again and plays', async () => {
    let refuse = true;
    const videoUrl = jest.fn(async (path: string) =>
      path === CLIP && refuse
        ? Promise.reject(new LiveRequestError(400, null, 'Object not found'))
        : Promise.resolve(signed(path)),
    );
    await render(<Lesson backend={backendWith(videoUrl)} enrolmentId="e1" lessonId="l1" />);
    await fireEvent.press(await screen.findByLabelText('Play the lesson video, 2:05 long'));
    expect(await screen.findByText(/The video did not load/u)).toBeTruthy();
    expect(screen.queryByText(/needs a connection/u)).toBeNull();
    expect(screen.getByText('Read the four phenotypes.')).toBeTruthy();

    refuse = false;
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('lesson-video-player')).toBeTruthy();
    expect(videoUrl.mock.calls.filter((c) => c[0] === CLIP)).toHaveLength(2);
  });

  it('a clip the player cannot load says so, with a retry', async () => {
    mockStatus = 'error';
    const videoUrl = jest.fn(async (path: string) => Promise.resolve(signed(path)));
    await render(<Lesson backend={backendWith(videoUrl)} enrolmentId="e1" lessonId="l1" />);
    await fireEvent.press(await screen.findByLabelText('Play the lesson video, 2:05 long'));
    expect(await screen.findByText(/The video did not load/u)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('a clip with no poster and no measured length still offers play, without inventing a length', async () => {
    const videoUrl = jest.fn(async (path: string) => Promise.resolve(signed(path)));
    await render(
      <Lesson
        backend={backendWith(videoUrl, {
          ...LESSON,
          video: { objectPath: CLIP, posterPath: null, durationSeconds: null },
        })}
        enrolmentId="e1"
        lessonId="l1"
      />,
    );
    expect(await screen.findByLabelText('Play the lesson video')).toBeTruthy();
    expect(screen.getByText('Video')).toBeTruthy();
    expect(videoUrl).not.toHaveBeenCalled();
  });

  it('a text-only lesson shows no player and asks for no URL', async () => {
    const videoUrl = jest.fn(async (path: string) => Promise.resolve(signed(path)));
    await render(
      <Lesson
        backend={backendWith(videoUrl, { ...LESSON, video: null })}
        enrolmentId="e1"
        lessonId="l1"
      />,
    );
    expect(await screen.findByText('Read the four phenotypes.')).toBeTruthy();
    expect(screen.queryByLabelText(/Play the lesson video/u)).toBeNull();
    expect(videoUrl).not.toHaveBeenCalled();
  });
});
