import type { CompanyNoticeVersion, NoticeVersionStatus } from '@fieldforce/core';
import type { Refusal } from './tracking-text';

/**
 * `FE-W91` / `BE-W201` — what the live-tracking notice screen says, in the admin's words.
 *
 * **Every rule is the database's**: which notice is in force (`current_live_tracking_notice`, read
 * through `live_tracking_notices`), who may approve (the `live_tracking_notice_approvals_valid`
 * trigger: an active admin of the company who is not the author), and the limits on a label and a
 * text (the table's checks). This file only names them, and repeats the two limits so the button
 * can stay disabled rather than letting an admin type 20,000 characters into a refusal. Pure, and
 * outside the `'use client'` files, so it is tested without a renderer.
 */

/** The table's checks (`live_tracking_notice_versions`): a label of 1–80, a text of 50–20,000. */
export const LABEL_MAX = 80;
export const BODY_MIN = 50;
export const BODY_MAX = 20_000;
/** `live_tracking_notice_approvals.attestation`: 3–500. */
export const ATTESTATION_MIN = 3;
export const ATTESTATION_MAX = 500;

/** Where the engineering draft lives, for an admin who wants to start from it. */
export const DRAFT_DOC_URL =
  'https://github.com/Praverse-Tech-Pvt-Ltd/Elmiron-App/blob/main/docs/operator/live-tracking-notice-DRAFT.md';

/** The consequence an approver must know BEFORE pressing Approve. */
export const REACCEPT_NOTE =
  'Approving a new version puts it in force at once, and every rep must read and accept it again ' +
  'before their location is shared again. Until a rep accepts, none of their positions is kept.';

export const statusLabel = (status: NoticeVersionStatus): string =>
  ({
    waiting: 'Waiting for a second admin',
    in_force: 'In force',
    superseded: 'Replaced by a later version',
  })[status];

const TONES = { waiting: 'attention', in_force: 'success', superseded: 'neutral' } as const;

export const statusTone = (status: NoticeVersionStatus): (typeof TONES)[NoticeVersionStatus] =>
  TONES[status];

export type ApprovalAffordance =
  | { readonly kind: 'may_approve' }
  | { readonly kind: 'waiting_for_another'; readonly reason: string }
  | { readonly kind: 'none' };

/**
 * Whether THIS admin is offered Approve. The trigger refuses the author whatever is drawn; the
 * screen says so first, so the author is told to find a second admin instead of being refused.
 */
export const approvalAffordance = (version: CompanyNoticeVersion): ApprovalAffordance => {
  if (version.status !== 'waiting') return { kind: 'none' };
  if (version.authoredByYou) {
    return {
      kind: 'waiting_for_another',
      reason:
        'You loaded this version, so you cannot approve it. Waiting for a second admin — ask ' +
        'another admin of your company to open this page and approve it.',
    };
  }
  return { kind: 'may_approve' };
};

/** Why the proposal cannot be sent yet, or null. The same limits the table holds. */
export const proposalProblem = (label: string, body: string): string | null => {
  const l = label.trim();
  const b = body.trim();
  if (l.length === 0) return 'Give this version a label, for example “v1 — 2026-10”.';
  if (l.length > LABEL_MAX) return `A label is at most ${String(LABEL_MAX)} characters.`;
  if (b.length < BODY_MIN) {
    return `Paste the full text of the notice — at least ${String(BODY_MIN)} characters.`;
  }
  if (b.length > BODY_MAX) return `The text is at most ${String(BODY_MAX)} characters.`;
  return null;
};

/**
 * A warning, not a refusal: the database would load it, and the admin may mean to. But a text still
 * carrying the draft's `[[ BLANK ]]` markers would be shown to every rep with the blanks in it.
 */
export const blankWarning = (body: string): string | null =>
  /\[\[\s*BLANK/u.test(body)
    ? 'This text still has a [[ BLANK ]] from the draft. Reps would see it exactly as written — fill every blank first.'
    : null;

export const attestationProblem = (attestation: string): string | null => {
  const a = attestation.trim();
  if (a.length < ATTESTATION_MIN) return 'Say what you checked before approving — it is kept.';
  if (a.length > ATTESTATION_MAX) {
    return `What you checked is at most ${String(ATTESTATION_MAX)} characters.`;
  }
  return null;
};

/** India time, to the minute: the console's operators are in India. */
export const when = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

/** Every refusal the notice functions and the tables make, in plain words, each with its remedy. */
export const noticeRefusal = ({ code, message }: Refusal): string => {
  if (/only an admin (loads|approves|manages)/u.test(message)) {
    return 'Only an admin loads or approves the live location notice. Ask an admin of your company.';
  }
  if (/author of a notice may not approve/u.test(message)) {
    return 'You loaded this version, so you cannot approve it. Ask a second admin to approve it. Nothing was changed.';
  }
  if (/engineering draft cannot be approved/u.test(message)) {
    return 'The engineering draft cannot be approved. Load your company’s own text below, then ask a second admin to approve it.';
  }
  if (/only an active admin of the notice's own company/u.test(message)) {
    return 'Only an active admin of this company approves its notice. Nothing was changed.';
  }
  if (/is not your company/u.test(message)) {
    return 'That version belongs to another company. Reload the page and choose one of yours.';
  }
  if (/notice_version_id_key/u.test(message)) {
    return 'This version is already approved. Reload the page to see it.';
  }
  if (/live_tracking_notice_label_once/u.test(message) || code === '23505') {
    return 'Your company already has a version with this label. Give the new one a different label, for example the next number.';
  }
  if (/version_label_check/u.test(message)) {
    return `A label is 1 to ${String(LABEL_MAX)} characters. Nothing was loaded.`;
  }
  if (/body_check/u.test(message)) {
    return `The notice text is ${String(BODY_MIN)} to ${String(BODY_MAX)} characters. Nothing was loaded.`;
  }
  if (/attestation_check/u.test(message)) {
    return `Say what you checked, in ${String(ATTESTATION_MIN)} to ${String(ATTESTATION_MAX)} characters. Nothing was approved.`;
  }
  if (code === '28000') return 'Your session has ended. Sign in again.';
  return `The server refused this: ${message}`;
};
