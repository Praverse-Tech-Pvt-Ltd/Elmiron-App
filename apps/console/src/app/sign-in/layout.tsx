import type { ReactNode } from 'react';
import { Cormorant_Garamond } from 'next/font/google';

/**
 * `FE-W122` — the console's single Cormorant moment, and the only file that loads the face.
 *
 * Phase 1 §03: "The one Cormorant moment — login splash only, weight 500." The field app enforces
 * that by letting only `BrandLine` name the family; the console enforces it by loading the face in
 * the sign-in segment's layout and nowhere else, so no other page could reach it even by mistake —
 * the variable `--ff-font-brand` does not exist outside this subtree.
 */
const brand = Cormorant_Garamond({
  subsets: ['latin'],
  weight: '500',
  display: 'swap',
  variable: '--ff-font-brand',
});

export default function SignInLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className={`${brand.variable} ff-signin`}>{children}</div>;
}
