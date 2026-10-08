/** Types for W2-I A's catalogue loader. */
import type { Problem, Target } from './content-loader.mjs';

export interface ParsedCatalogue {
  title: string;
  markets: { code: string; name: string; line: number }[];
  products: { brand: string; generic: string; area: string; markets: string[]; line: number }[];
}
export declare const checkCatalogue: (text: string) => {
  catalogue: ParsedCatalogue;
  problems: Problem[];
};
export declare const loadCatalogue: (
  catalogue: ParsedCatalogue,
  target: Target,
) => Promise<{
  marketsCreated: number;
  marketsAlreadyHeld: number;
  productsCreated: number;
  productsAlreadyHeld: number;
  therapyAreasCreated: number;
  linksCreated: number;
}>;
