/** Types for W2-I A4's content step (`BE-W168`). */
import type { Target } from './content-loader.mjs';

export declare const contentStep: (
  step: 'publish-course' | 'submit-knowledge',
  title: string,
  target: Target,
) => Promise<{ versionId: string; versionNumber: number; status: string }>;
