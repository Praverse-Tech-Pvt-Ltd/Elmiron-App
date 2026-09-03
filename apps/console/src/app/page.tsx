import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

/**
 * The coaching queue is the landing surface.
 *
 * Phase 4: "Exception-first. The coaching queue is the landing surface — not a
 * team scoreboard, because there isn't one." A console that opened on a table of
 * everybody would be the scoreboard the product does not have.
 */
export default function Home(): ReactNode {
  redirect('/coaching');
}
