import type { SimPersona, SimScenario } from '@fieldforce/core';

/**
 * W1-F B4 — the row a persona and a scenario both become, and the two functions that build it.
 *
 * **Why this is its own module and not part of `sim-content.tsx`.** That file is `'use client'`,
 * and a `'use client'` module's exports are client REFERENCES, not functions — calling one from a
 * Server Component fails at request time with *"Attempted to call simPersonaRow() from the server
 * but simPersonaRow is on the client"*. The page is a Server Component and builds these rows while
 * rendering, so the pure part lives here, where both sides can call it.
 *
 * That was not a design decision made in advance: `/practice` returned 500 the first time it was
 * requested with a real cookie, and this is the fix. Recorded rather than quietly corrected,
 * because it is the second time in this repository that a thing built and typechecked cleanly was
 * nevertheless unreachable until something actually called it.
 */

export type SimContentKind = 'persona' | 'scenario';

export interface SimContentRow {
  readonly kind: SimContentKind;
  readonly id: string;
  readonly status: SimPersona['status'];
  readonly createdByUserId: string;
  readonly submittedByUserId: string | null;
  readonly title: string;
  /** The lines a reviewer reads before deciding. Label/value pairs, rendered in order. */
  readonly detail: readonly (readonly [string, string])[];
  readonly authorship: SimPersona['authorship'];
  readonly authoringModel: string | null;
}

/** B4 — an approver cannot approve what they cannot find. */
export const simPersonaRow = (p: SimPersona): SimContentRow => ({
  kind: 'persona',
  id: p.id,
  status: p.status,
  createdByUserId: p.createdByUserId,
  submittedByUserId: p.submittedByUserId,
  title: p.displayName,
  detail: [
    ['Specialty', p.specialty],
    ['How they behave', p.stance],
    ['Brief', p.brief],
  ],
  authorship: p.authorship,
  authoringModel: p.authoringModel,
});

export const simScenarioRow = (
  s: SimScenario,
  personaName: string,
  productName: string | null,
  marketName: string | null,
): SimContentRow => ({
  kind: 'scenario',
  id: s.id,
  status: s.status,
  createdByUserId: s.createdByUserId,
  submittedByUserId: s.submittedByUserId,
  title: s.title,
  detail: [
    ['Practice doctor', personaName],
    ['What the rep should achieve', s.objective],
    ['The objection', s.objection],
    ['Product', productName ?? 'Not about a specific product'],
    ['Market', marketName ?? 'No market'],
  ],
  authorship: s.authorship,
  authoringModel: s.authoringModel,
});
