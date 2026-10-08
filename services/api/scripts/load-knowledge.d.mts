/** Types for W2-H A2's approved-material loader. */
import type { Problem, Target } from './content-loader.mjs';

export interface ParsedDocument {
  title: string;
  type: string;
  product: string;
  market: string;
  source: string;
  effective: string;
  review: string;
  body: string;
}
export declare const DOCUMENT_TYPES: string[];
export declare const checkKnowledge: (text: string) => { doc: ParsedDocument; problems: Problem[] };
export declare const loadKnowledge: (
  doc: ParsedDocument,
  target: Target,
) => Promise<{ documentId: string; versionId: string; versionNumber: number; status: string }>;
