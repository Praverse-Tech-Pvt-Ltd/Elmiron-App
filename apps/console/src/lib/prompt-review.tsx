'use client';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  GATEWAY_FEATURES,
  GATEWAY_MODEL,
  GATEWAY_MODEL_LABEL,
  GATEWAY_OUTPUT_SCHEMA_NAME,
  PromptModelConfigSchema,
} from '@fieldforce/core';
import type { AiPromptVersion, GatewayFeature, PromptModelConfig } from '@fieldforce/core';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { Body, Card, Heading, Label, MissingNote, Pill } from './ui';
import { approvalAffordance } from './knowledge-review';

/**
 * W1-G E1 / `BE-W122` — drafting and approving the text a model is given.
 *
 * **Why this screen had to exist before practice could be turned on by anybody.** W1-F built the
 * persona and scenario screens and proved `start_sim_session` accepting where it refused — but only
 * after an approved `ai_doctor` prompt was written **into the database by a script**.
 * `ai_prompt_versions` had RLS, a lifecycle and four RPCs, and **no screen**, so the operator
 * checklist carried one step that said *"an engineer runs SQL"*, which is the step the whole of
 * W1-F existed to remove.
 *
 * **A correction to the `BE-W122` register entry, recorded because it was mine.** That entry said
 * the table had *"no RPC and no console route"*. **The RPCs exist** — `submit_ai_prompt_version`,
 * `approve_ai_prompt_version`, `reject_ai_prompt_version` and `retire_ai_prompt_version`, all four
 * in `AI_RPC` since `20260924000700`. Only the route was missing. **I registered a defect without
 * grepping for the thing I claimed was absent**, which is the same hearsay the standing rules
 * forbid.
 *
 * **`approvalAffordance` is imported for the THIRD time**, from `knowledge-review.tsx`, unchanged.
 * A prompt version carries the same `status`, `createdByUserId` and `submittedByUserId` as a
 * knowledge version and a persona, because it carries the same lifecycle. `BE-W121` argues the
 * generic helper should wait for a fourth content type; this is the fourth **screen**, not the
 * fourth lifecycle, and the shared helper is why it costs nothing.
 *
 * **What this screen does NOT do, and both are deliberate:**
 *
 * * **It does not draft prompt text with a model.** That would be a model writing its own
 *   instructions, and `C24` would have nothing left to mean.
 * * **It does not explain what to write.** The prompt is a training judgement — `docs/blocked-on-you.md`
 *   → W1-F Part C names who should write each of the two texts. A form that coached the author
 *   would be the engineering track making that judgement by the back door.
 */

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

const box = (): CSSProperties => ({ ...field(), minHeight: 160 });

export const PROMPT_REGULATED_CAUTION =
  'A prompt must not contain a product claim, an indication or prescribing information. Those are ' +
  'regulated promotional content and must come from an approved label, never from a model and ' +
  'never from this box.';

export const PROMPT_DRAFT_NOTE =
  'Saved as a DRAFT. No model is given this text until a SECOND admin approves it.';

export const PROMPT_ONE_APPROVED_NOTE =
  'One approved prompt per feature. Approving this retires nothing automatically — retire the old ' +
  'one when you are satisfied the new one behaves.';

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

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
      // The server's refusal, unchanged. Nothing here softens a SQLSTATE into reassurance.
      setState({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'The server refused this.',
      });
    });
};

// ---------------------------------------------------------------------------

/**
 * W2-E A3 (`BE-W164`). What a version carries besides its text, said on the screen.
 *
 * * **The model is SHOWN, not chosen.** It is fixed per feature in code (`GATEWAY_MODEL`) because the
 *   gateway maps it to an India inference profile and the adapter refuses any other; a model picker
 *   here would make data residency a form field.
 * * **The limits are REQUIRED, with no default filled in.** Left out, the version runs on the
 *   vendor's defaults — a length and a temperature nobody approved. Typed here, they are frozen
 *   with the text at submission (`ai_prompt_versions_before_update`), so the approver signs the
 *   limits as well as the words.
 * * **The output check is shown, not typed** — derived from the feature by `promptDraftRow`.
 */
export const PROMPT_LIMITS_NOTE =
  'Both limits are required. The approver signs them with the text, and they cannot change after ' +
  'submission. The drafts in docs/ai-platform/drafts propose numbers for each feature.';

/** `''` while empty: `Number('')` is 0, which would read an empty box as a real temperature. */
const limitsFrom = (temperature: string, maxTokens: string): PromptModelConfig | null => {
  if (temperature.trim() === '' || maxTokens.trim() === '') return null;
  const parsed = PromptModelConfigSchema.safeParse({
    temperature: Number(temperature),
    maxTokens: Number(maxTokens),
  });
  return parsed.success ? parsed.data : null;
};

/**
 * The review card's line about limits and output check, from the row. A version the gateway would
 * refuse SAYS so before anyone approves it — the approver is the last person who can catch it.
 */
export const versionSettings = (version: AiPromptVersion): string => {
  const parts: string[] = [];
  const limits = PromptModelConfigSchema.safeParse(version.modelConfig);
  parts.push(
    limits.success
      ? `Temperature ${String(limits.data.temperature)} · longest answer ${String(limits.data.maxTokens)} tokens`
      : 'No valid limits — this version would run on the vendor’s defaults',
  );
  const expected = (GATEWAY_FEATURES as readonly string[]).includes(version.feature)
    ? GATEWAY_OUTPUT_SCHEMA_NAME[version.feature as GatewayFeature]
    : null;
  parts.push(
    expected !== null && version.outputSchemaName === expected
      ? `output checked against ${expected}`
      : 'the gateway will REFUSE this version: its output check is not the one this feature needs',
  );
  return parts.join(' · ');
};

export interface PromptDraftProps {
  readonly features: readonly GatewayFeature[];
  readonly onCreate: (input: {
    feature: GatewayFeature;
    systemPrompt: string;
    modelConfig: PromptModelConfig;
  }) => Promise<void>;
}

export const PromptDraftForm = ({ features, onCreate }: PromptDraftProps): ReactNode => {
  const [feature, setFeature] = useState<GatewayFeature | ''>(features[0] ?? '');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const limits = limitsFrom(temperature, maxTokens);
  const ready = feature !== '' && systemPrompt.trim() !== '' && limits !== null;

  return (
    <Card>
      <Heading>New prompt</Heading>
      <Body muted>{PROMPT_DRAFT_NOTE}</Body>

      <Label>Which feature this prompt is for</Label>
      <select
        aria-label="Which feature this prompt is for"
        style={field()}
        value={feature}
        onChange={(e) => {
          setFeature(e.target.value as GatewayFeature);
        }}
      >
        {features.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      {feature !== '' ? (
        <Body muted>
          Answered by {GATEWAY_MODEL_LABEL[GATEWAY_MODEL[feature]]} — fixed for this feature. Output
          checked against {GATEWAY_OUTPUT_SCHEMA_NAME[feature]}.
        </Body>
      ) : null}

      <Label>The instructions the model is given</Label>
      <textarea
        aria-label="The instructions the model is given"
        style={box()}
        value={systemPrompt}
        onChange={(e) => {
          setSystemPrompt(e.target.value);
        }}
      />
      <MissingNote>{PROMPT_REGULATED_CAUTION}</MissingNote>

      <Label>Temperature, from 0 to 1</Label>
      <input
        aria-label="Temperature, from 0 to 1"
        inputMode="decimal"
        style={field()}
        value={temperature}
        onChange={(e) => {
          setTemperature(e.target.value);
        }}
      />
      <Label>Longest answer, in tokens (1 to 8192)</Label>
      <input
        aria-label="Longest answer, in tokens"
        inputMode="numeric"
        style={field()}
        value={maxTokens}
        onChange={(e) => {
          setMaxTokens(e.target.value);
        }}
      />
      <Body muted>{PROMPT_LIMITS_NOTE}</Body>

      {/* The version number is NOT offered. `ai_prompt_versions_before_insert()` computes it as
          max+1 per organisation per feature and overwrites whatever arrives, so a field here would
          be a control that does nothing — the shape this repository keeps finding. */}

      {state.kind === 'done' ? <Body>{state.message}</Body> : null}
      {state.kind === 'failed' ? <MissingNote>{state.message}</MissingNote> : null}

      <button
        type="button"
        style={button()}
        disabled={!ready || state.kind === 'busy'}
        onClick={() => {
          if (feature === '' || limits === null) return;
          runAction(
            () => onCreate({ feature, systemPrompt: systemPrompt.trim(), modelConfig: limits }),
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

export interface PromptReviewProps {
  readonly version: AiPromptVersion;
  readonly viewerUserId: string;
  readonly onSubmit: () => Promise<void>;
  readonly onApprove: (attestation: string) => Promise<void>;
  readonly onReject: (reason: string) => Promise<void>;
}

export const PromptReview = ({
  version,
  viewerUserId,
  onSubmit,
  onApprove,
  onReject,
}: PromptReviewProps): ReactNode => {
  const [attestation, setAttestation] = useState('');
  const [reason, setReason] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  // The same rule, the same sentences, one implementation. Third caller.
  const affordance = approvalAffordance(version, viewerUserId);
  const busy = state.kind === 'busy';

  return (
    <Card>
      <Heading>
        {version.feature} — version {version.versionNumber}
      </Heading>
      <div style={{ display: 'flex', gap: tokens.space.xs, flexWrap: 'wrap' }}>
        <Pill tone={version.status === 'approved' ? 'success' : 'neutral'}>{version.status}</Pill>
      </div>

      <Label>The instructions the model is given</Label>
      <Body>
        {/* Whole, with its line breaks. A reviewer approving a truncated prompt is approving
            something they did not read. */}
        <span style={{ whiteSpace: 'pre-wrap' }}>{version.systemPrompt}</span>
      </Body>

      {/* W2-E A3: what the approver signs besides the words. Read from the ROW, so a version
          written before W2-E — or by hand — shows what it actually carries, including nothing. */}
      <Label>Limits and output check</Label>
      <Body>{versionSettings(version)}</Body>

      {version.status === 'approved' ? <Body muted>{PROMPT_ONE_APPROVED_NOTE}</Body> : null}

      {state.kind === 'done' ? <Body>{state.message}</Body> : null}
      {state.kind === 'failed' ? <MissingNote>{state.message}</MissingNote> : null}

      {version.status === 'draft' ? (
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

      {version.status === 'in_review' && affordance.kind === 'hidden' ? (
        <MissingNote>{affordance.reason}</MissingNote>
      ) : null}

      {version.status === 'in_review' && affordance.kind === 'may_decide' ? (
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
          <div style={{ display: 'flex', gap: tokens.space.sm }}>
            <button
              type="button"
              style={button()}
              disabled={busy || attestation.trim() === ''}
              onClick={() => {
                runAction(
                  () => onApprove(attestation.trim()),
                  'Approved. This is the prompt the feature now uses.',
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
