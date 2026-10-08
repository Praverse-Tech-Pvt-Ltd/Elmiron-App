/** Types for W2-H A1's course loader. */
import type { Problem, Target } from './content-loader.mjs';

export interface ParsedCourse {
  title: string;
  market: string;
  product: string;
  summary: string;
  modules: {
    title: string;
    line: number;
    lessons: { title: string; minutes: number | null; body: string; line: number }[];
  }[];
}
export declare const checkCourse: (text: string) => { course: ParsedCourse; problems: Problem[] };
export declare const loadCourse: (
  course: ParsedCourse,
  target: Target,
) => Promise<{
  courseId: string;
  versionId: string;
  versionNumber: number;
  modules: number;
  lessons: number;
}>;
