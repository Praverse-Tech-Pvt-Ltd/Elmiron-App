import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

/** Consent versions is the only admin screen built, so it is the landing page. */
export default function Home(): ReactNode {
  redirect('/admin');
}
