'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { createApiClient } from '@fieldforce/core';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { Body, Card, Heading, Label, MissingNote } from './ui';

/**
 * E2's decision, and the only interactive thing in the console.
 *
 * **Agree and Disagree are identical controls.** Same size, same fill, same border,
 * same type, side by side, one tap each, no confirm on either. `OverrideControl`
 * in `packages/ui` made the same choice for the same reason and its comment is the
 * argument: "making disagreement the harder path would quietly turn an advisory
 * system into an authority". The accent colour appears on neither.
 *
 * **Agreeing writes nothing.** There is no `agree` endpoint in the contract and
 * there should not be: agreement is the absence of an override, and manufacturing
 * a row for it would turn every unreviewed finding into an implied endorsement the
 * moment somebody wanted a metric out of it. Agreeing closes the screen.
 *
 * **A reason is required to disagree, and the contract enforces it too.**
 * `CreateAnalysisOverrideRequestSchema.reason` is `.min(1)`. An override with no
 * reason proves a click happened, not that anybody thought — and this row is the
 * evidence of human oversight, so an empty one is worse than none.
 */
export interface OverrideFormProps {
  readonly analysisId: string;
  readonly baseUrl: string;
  /** The finding being overridden, when there is exactly one in question. */
  readonly findingId: string | null;
}

type State =
  | { readonly kind: 'undecided' }
  | { readonly kind: 'agreed' }
  | { readonly kind: 'disagreeing' }
  | { readonly kind: 'logged' }
  | { readonly kind: 'failed'; readonly message: string };

const button = (): React.CSSProperties => ({
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

export const OverrideForm = ({ analysisId, baseUrl, findingId }: OverrideFormProps): ReactNode => {
  const [state, setState] = useState<State>({ kind: 'undecided' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const log = (): void => {
    if (busy || reason.trim() === '') return;
    setBusy(true);
    const client = createApiClient({ baseUrl, getAccessToken: () => Promise.resolve(null) });
    void client
      .createAnalysisOverride(analysisId, {
        findingId,
        reason: reason.trim(),
      })
      .then(() => {
        setState({ kind: 'logged' });
      })
      .catch((error: unknown) => {
        setState({
          kind: 'failed',
          message:
            error instanceof Error
              ? `${error.message} Your reason is still on the screen.`
              : 'Your reason is still on the screen.',
        });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Card>
      <MissingNote>
        <strong>This finding is advisory.</strong> Nothing happens to the MR unless you act, and no
        score is being kept.
      </MissingNote>

      {state.kind === 'logged' ? (
        <>
          <Heading>Override logged</Heading>
          <Body muted>
            The MR is told you overrode it, and your reason. The rubric owner sees it in the weekly
            accuracy report. The finding itself is unchanged — the analysis they read stays as they
            read it.
          </Body>
        </>
      ) : state.kind === 'agreed' ? (
        <>
          <Heading>Agreed — nothing was written</Heading>
          <Body muted>
            Agreement is the absence of an override. There is no row for it, deliberately: a record
            of every agreement would become a metric, and a metric would become pressure to agree.
          </Body>
        </>
      ) : (
        <>
          <Heading>Do you agree with it?</Heading>
          <div style={{ display: 'flex', gap: tokens.space.sm }}>
            <button
              onClick={() => {
                setState({ kind: 'agreed' });
              }}
              style={button()}
              type="button"
            >
              Agree
            </button>
            <button
              onClick={() => {
                setState({ kind: 'disagreeing' });
              }}
              style={button()}
              type="button"
            >
              Disagree
            </button>
          </div>

          {state.kind === 'disagreeing' || state.kind === 'failed' ? (
            <>
              <Label>Why — one line, logged against the rubric</Label>
              <textarea
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                rows={4}
                style={{
                  background: tokens.color.background,
                  border: `1px solid ${tokens.color.border}`,
                  borderRadius: tokens.radius.well,
                  padding: tokens.space.sm,
                  fontSize: compactTypography.value.size,
                  color: tokens.color.textPrimary,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
                value={reason}
              />
              {state.kind === 'failed' ? <MissingNote>{state.message}</MissingNote> : null}
              <button
                disabled={busy || reason.trim() === ''}
                onClick={log}
                style={{
                  ...button(),
                  background: reason.trim() === '' ? tokens.color.wash : tokens.color.accent,
                  color: reason.trim() === '' ? tokens.color.textSecondary : tokens.color.onAccent,
                  border: 'none',
                  cursor: reason.trim() === '' ? 'not-allowed' : 'pointer',
                }}
                type="button"
              >
                {busy ? 'Logging…' : 'Log the override'}
              </button>
              {reason.trim() === '' ? (
                <Label>
                  A reason is required. An override with none proves a click happened, not that
                  anybody thought.
                </Label>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Card>
  );
};
