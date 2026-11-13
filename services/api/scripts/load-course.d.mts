/** Types for W2-H A1's course loader, with `BE-W210`'s lesson videos. */
import type { Problem, Target } from './content-loader.mjs';
import type { ProbeFacts } from './trim-video.mjs';

/** A `Video:` or `Poster:` line; `file`, `bytes` (and a clip's `durationSeconds`) once checked. */
export interface MediaRef {
  path: string;
  line: number;
  file?: string;
  bytes?: number;
  durationSeconds?: number | null;
}

export interface ParsedCourse {
  title: string;
  market: string;
  product: string;
  summary: string;
  modules: {
    title: string;
    line: number;
    lessons: {
      title: string;
      minutes: number | null;
      video: MediaRef | null;
      poster: MediaRef | null;
      body: string;
      line: number;
    }[];
  }[];
}
export declare const checkCourse: (text: string) => { course: ParsedCourse; problems: Problem[] };
export declare const checkCourseMedia: (
  course: ParsedCourse,
  options: {
    baseDir: string;
    sizeOf?: (file: string) => number | null;
    probe?: ((file: string) => ProbeFacts) | null;
  },
) => { problems: Problem[]; notes: string[]; clips: number };
export declare const uploadLessonFile: (input: {
  url: string;
  apiKey: string;
  token: string;
  objectPath: string;
  body: Uint8Array;
  contentType: string;
  fetchImpl?: typeof fetch;
}) => Promise<'uploaded' | 'already there'>;
export declare const loadCourse: (
  course: ParsedCourse,
  target: Target & { baseDir?: string },
) => Promise<{
  courseId: string;
  versionId: string;
  versionNumber: number;
  modules: number;
  lessons: number;
  videos: number;
}>;
