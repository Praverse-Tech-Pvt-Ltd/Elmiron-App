'use client';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { SimPersonaStance } from '@fieldforce/core';
import { SIM_PERSONA_STANCES } from '@fieldforce/core';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { Body, Card, Heading, Label, MissingNote, Pill } from './ui';
import { approvalAffordance } from './knowledge-review';
import type { SimContentRow } from './sim-content-row';

/**
 * W1-F B1/B2/B3/B4 — authoring and approving a practice persona and scenario.
 *
 * **Why this screen is the whole point of the session.** `CR-5` D3 listed eight things needed to run
 * ONE practice session. Two are operator accounts and flags. **Four were content that could not be
 * created at all**, because the tables existed and nothing could write to them but a test. AI Doctor
 * was built, proven end to end, and unreachable — not because of `#5`, but because nobody could
 * author a scenario.
 *
 * **What is REUSED rather than rewritten, which `W1-F B1` requires.**
 *
 * * **`approvalAffordance` is imported from `knowledge-review.tsx`, not reimplemented.** A persona
 *   and a scenario carry the same three fields it reads — `status`, `createdByUserId`,
 *   `submittedByUserId` — because they carry the same lifecycle. One helper, one set of refusal
 *   sentences, and a change to the four-eyes rule can only be made in one place.
 * * **The RPCs are `submit/approve/reject_sim_content`**, one implementation covering both tables,
 *   and the same `draft → in_review → approved` machine knowledge uses.
 *
 * **THE SERVER IS STILL THE CONTROL.** `approve_sim_content` refuses `42501` if the caller wrote or
 * submitted it and `22023` on an empty attestation, whatever this file draws. Hiding a control is
 * **legibility**, not enforcement — a button that always fails for the author is a worse screen than
 * no button, and that is the only claim being made here.
 */

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const button = (): CSSProperties => ({
  flex: 1,
  minHeight: 52,
  background: tokens.color.surface,
  border: `2px solid ${tokens.color.textPrimary}`,
  borderRadius: tokens.radius.control,
  color: tokens.color.textPrimary,
  fontSize: compactTypography.control.size,
  fontWeight: Number(compactTypography.control.weight),
  cursor: 'pointer',
});

const field = (): CSSProperties => ({
  width: '100%',
  padding: tokens.space.sm,
  border: `1px solid ${tokens.color.textPrimary}`,
  borderRadius: tokens.radius.control,
  fontSize: compactTypography.body.size,
  fontFamily: 'inherit',
});

const box = (): CSSProperties => ({ ...field(), minHeight: 96 });

export const PERSONA_NAME_CAUTION =
  'This name is shown to the rep as the doctor they are practising with. Use a label such as ' +
  '"Dr A. Sharma (practice)". Never a real doctor’s name: no rule can check that, and this is ' +
  'the only place it is checked at all.';

export const SCENARIO_MARKET_CAUTION =
  'A scenario about a product must name the market it applies to. One country’s promotional or ' +
  'regulatory content never applies everywhere, and the server refuses a product with no market.';

export const SIM_DRAFT_NOTE =
  'Saved as a DRAFT. Nothing a rep can practise against until a SECOND admin approves it.';

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/** One failure path for every call on this screen: show what the server said, unchanged. */
const runAction = (
  action: () => Promise<void>,
  doneMessage: string,
  setState: (s: State) => void,
): void => {
  setState({ kind: 'busy' });
  action()
    .then(() => {
      setState({ kind: 'done', message: doneMessage });
    })
    .catch((error: unknown) => {
      // The server's refusal is surfaced as it is. Nothing here translates a SQLSTATE into
      // reassurance -- if the database refused, the admin needs to know it refused.
      setState({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'The server refused this.',
      });
    });
};

// ---------------------------------------------------------------------------
// B1 — drafting a persona
// ---------------------------------------------------------------------------

export interface PersonaDraftProps {
  readonly onCreate: (input: {
    displayName: string;
    specialty: string;
    stance: SimPersonaStance;
    brief: string;
  }) => Promise<void>;
}

export const PersonaDraftForm = ({ onCreate }: PersonaDraftProps): ReactNode => {
  const [displayName, setDisplayName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [stance, setStance] = useState<SimPersonaStance>('sceptical');
  const [brief, setBrief] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const ready = displayName.trim() !== '' && specialty.trim() !== '' && brief.trim() !== '';

  return (
    <Card>
      <Heading>New practice doctor</Heading>
      <Body muted>{SIM_DRAFT_NOTE}</Body>

      <Label>Name shown to the rep</Label>
      <input
        aria-label="Name shown to the rep"
        style={field()}
        value={displayName}
        onChange={(e) => {
          setDisplayName(e.target.value);
        }}
      />
      <MissingNote>{PERSONA_NAME_CAUTION}</MissingNote>

      <Label>Specialty</Label>
      <input
        aria-label="Specialty"
        style={field()}
        value={specialty}
        onChange={(e) => {
          setSpecialty(e.target.value);
        }}
      />

      <Label>How they behave</Label>
      {/* A closed set, not free text. The value goes into a prompt, and an admin typing a paragraph
          here would be writing prompt text through a field with no approval of its own. */}
      <select
        aria-label="How they behave"
        style={field()}
        value={stance}
        onChange={(e) => {
          setStance(e.target.value as SimPersonaStance);
        }}
      >
        {SIM_PERSONA_STANCES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <Label>Brief — what this doctor knows and cares about</Label>
      <textarea
        aria-label="Brief"
        style={box()}
        value={brief}
        onChange={(e) => {
          setBrief(e.target.value);
        }}
      />

      {state.kind === 'done' ? <Body>{state.message}</Body> : null}
      {state.kind === 'failed' ? <MissingNote>{state.message}</MissingNote> : null}

      <button
        type="button"
        style={button()}
        disabled={!ready || state.kind === 'busy'}
        onClick={() => {
          runAction(
            () =>
              onCreate({
                displayName: displayName.trim(),
                specialty: specialty.trim(),
                stance,
                brief: brief.trim(),
              }),
            'Saved as a draft. Submit it for review when it is ready.',
            setState,
          );
        }}
      >
        Save draft
      </button>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// B2 — drafting a scenario
// ---------------------------------------------------------------------------

export interface ScenarioDraftProps {
  readonly personas: readonly { readonly id: string; readonly displayName: string }[];
  readonly products: readonly { readonly id: string; readonly brandName: string }[];
  readonly markets: readonly { readonly id: string; readonly name: string }[];
  readonly onCreate: (input: {
    personaId: string;
    title: string;
    objective: string;
    objection: string;
    productId: string | null;
    marketId: string | null;
  }) => Promise<void>;
}

export const ScenarioDraftForm = ({
  personas,
  products,
  markets,
  onCreate,
}: ScenarioDraftProps): ReactNode => {
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [objection, setObjection] = useState('');
  const [productId, setProductId] = useState('');
  const [marketId, setMarketId] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  // B2: a product must name a market. The SERVER enforces it
  // (`sim_scenarios_product_names_market`); this only stops the admin discovering it after typing
  // everything else.
  const productWithoutMarket = productId !== '' && marketId === '';
  const ready =
    personaId !== '' &&
    title.trim() !== '' &&
    objective.trim() !== '' &&
    objection.trim() !== '' &&
    !productWithoutMarket;

  if (personas.length === 0) {
    return (
      <Card>
        <Heading>New practice scenario</Heading>
        <MissingNote>
          A scenario needs an APPROVED practice doctor first. Create one above and have a second
          admin approve it.
        </MissingNote>
      </Card>
    );
  }

  return (
    <Card>
      <Heading>New practice scenario</Heading>
      <Body muted>{SIM_DRAFT_NOTE}</Body>

      <Label>Practice doctor</Label>
      <select
        aria-label="Practice doctor"
        style={field()}
        value={personaId}
        onChange={(e) => {
          setPersonaId(e.target.value);
        }}
      >
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </select>

      <Label>Title</Label>
      <input
        aria-label="Title"
        style={field()}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />

      <Label>What the rep should achieve</Label>
      <textarea
        aria-label="What the rep should achieve"
        style={box()}
        value={objective}
        onChange={(e) => {
          setObjective(e.target.value);
        }}
      />

      <Label>The objection the doctor will raise</Label>
      <textarea
        aria-label="The objection the doctor will raise"
        style={box()}
        value={objection}
        onChange={(e) => {
          setObjection(e.target.value);
        }}
      />

      <Label>Product — optional</Label>
      <select
        aria-label="Product"
        style={field()}
        value={productId}
        onChange={(e) => {
          setProductId(e.target.value);
        }}
      >
        <option value="">Not about a specific product</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.brandName}
          </option>
        ))}
      </select>

      <Label>Market{productId === '' ? ' — optional' : ' — REQUIRED for a product'}</Label>
      <select
        aria-label="Market"
        style={field()}
        value={marketId}
        onChange={(e) => {
          setMarketId(e.target.value);
        }}
      >
        <option value="">No market</option>
        {markets.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {productWithoutMarket ? <MissingNote>{SCENARIO_MARKET_CAUTION}</MissingNote> : null}

      {state.kind === 'done' ? <Body>{state.message}</Body> : null}
      {state.kind === 'failed' ? <MissingNote>{state.message}</MissingNote> : null}

      <button
        type="button"
        style={button()}
        disabled={!ready || state.kind === 'busy'}
        onClick={() => {
          runAction(
            () =>
              onCreate({
                personaId,
                title: title.trim(),
                objective: objective.trim(),
                objection: objection.trim(),
                productId: productId === '' ? null : productId,
                marketId: marketId === '' ? null : marketId,
              }),
            'Saved as a draft. Submit it for review when it is ready.',
            setState,
          );
        }}
      >
        Save draft
      </button>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// B3/B4 — the review card, and the list it lives in
// ---------------------------------------------------------------------------

export const AI_DRAFT_CAUTION =
  'A model produced this text. Approving it makes it the doctor a rep practises against. Read it ' +
  'as a draft, not as a summary you are confirming.';

export interface SimContentReviewProps {
  readonly row: SimContentRow;
  readonly viewerUserId: string;
  readonly onSubmit: () => Promise<void>;
  readonly onApprove: (attestation: string) => Promise<void>;
  readonly onReject: (reason: string) => Promise<void>;
}

export const SimContentReview = ({
  row,
  viewerUserId,
  onSubmit,
  onApprove,
  onReject,
}: SimContentReviewProps): ReactNode => {
  const [attestation, setAttestation] = useState('');
  const [reason, setReason] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  // REUSED from the knowledge screen. A persona and a scenario carry the same three fields because
  // they carry the same lifecycle; a second copy of this rule is a second place for it to drift.
  const affordance = approvalAffordance(row, viewerUserId);
  const busy = state.kind === 'busy';

  return (
    <Card>
      <Heading>{row.title}</Heading>
      <div style={{ display: 'flex', gap: tokens.space.xs, flexWrap: 'wrap' }}>
        <Pill tone="neutral">{row.kind}</Pill>
        <Pill tone={row.status === 'approved' ? 'success' : 'neutral'}>{row.status}</Pill>
      </div>

      {row.detail.map(([label, value]) => (
        <div key={label}>
          <Label>{label}</Label>
          <Body>
            <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>
          </Body>
        </div>
      ))}

      <Label>Who produced this text</Label>
      <Body>
        {row.authorship === 'ai_generated'
          ? `A model: ${row.authoringModel ?? 'unnamed'}.`
          : 'A person.'}
      </Body>
      {row.authorship === 'ai_generated' ? <MissingNote>{AI_DRAFT_CAUTION}</MissingNote> : null}

      {state.kind === 'done' ? <Body>{state.message}</Body> : null}
      {state.kind === 'failed' ? <MissingNote>{state.message}</MissingNote> : null}

      {row.status === 'draft' ? (
        <button
          type="button"
          style={button()}
          disabled={busy}
          onClick={() => {
            runAction(onSubmit, 'Submitted. A second admin must now approve it.', setState);
          }}
        >
          Submit for review
        </button>
      ) : null}

      {row.status === 'in_review' && affordance.kind === 'hidden' ? (
        <MissingNote>{affordance.reason}</MissingNote>
      ) : null}

      {row.status === 'in_review' && affordance.kind === 'may_decide' ? (
        <>
          <Label>Your attestation — required to approve</Label>
          <textarea
            aria-label="Your attestation"
            style={box()}
            value={attestation}
            onChange={(e) => {
              setAttestation(e.target.value);
            }}
          />
          <Label>Or a reason — required to reject</Label>
          <textarea
            aria-label="Reason for rejecting"
            style={box()}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          {/* Approve and Reject are the same control, side by side, one click each, no confirm on
              either -- the choice `override-form.tsx` and the knowledge screen both made, for the
              same reason: making one path harder turns a review into a rubber stamp. */}
          <div style={{ display: 'flex', gap: tokens.space.sm }}>
            <button
              type="button"
              style={button()}
              disabled={busy || attestation.trim() === ''}
              onClick={() => {
                runAction(
                  () => onApprove(attestation.trim()),
                  'Approved. Reps can practise against this.',
                  setState,
                );
              }}
            >
              Approve
            </button>
            <button
              type="button"
              style={button()}
              disabled={busy || reason.trim() === ''}
              onClick={() => {
                runAction(() => onReject(reason.trim()), 'Rejected. This is final.', setState);
              }}
            >
              Reject
            </button>
          </div>
        </>
      ) : null}
    </Card>
  );
};
