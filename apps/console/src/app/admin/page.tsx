import type { ReactNode } from 'react';
import { tokens } from '@fieldforce/ui-tokens';
import { consentTextVersions } from '../../lib/consent-text';
import { signedIn } from '../../lib/session';
import {
  Body,
  Card,
  Figure,
  Heading,
  Label,
  MissingNote,
  Pill,
  Title,
  cell,
  headerCell,
} from '../../lib/ui';
import { dateFrom, versionRows } from '../../lib/versions';
import {
  AUDIT_CAVEAT,
  AUDIT_HEADING,
  auditRows,
  emptyTrailNote,
  hiddenRowsNote,
  refusedNote,
} from '../../lib/audit';
import { purgeNotice, retentionFigures, retentionSentence } from '../../lib/retention';

/**
 * Phase 4 E3 — consent versions, audit and retention.
 *
 * **This is the only Phase 4 console screen that exists**, and the reason is
 * §3.6: the coaching queue (E1) and the analysis review (E2) both put an analysis
 * in front of a manager, which the 3 September decision did not reopen. E3 shows
 * no transcript, no analysis and no AI output at all — it is a compliance surface
 * — so it was never blocked.
 *
 * **All three panels now have data — `FE-W13`, MR-41 C2.** Two of them said *"Not
 * built … no path in `API_PATHS` exposes it"* for four sessions. That stopped being
 * true when `BE-W14` and `BE-W15` landed the read paths in MR-39:
 * `API_PATHS.auditLog` and `API_PATHS.retentionStatus` exist, and the client has
 * `listAuditLog` and `getRetentionStatus`. **A panel that says "not built" about a
 * path that now exists is the same defect `FE-W10` was raised for**, one file over.
 *
 * ### The two things this screen must not do
 *
 * **It must not print a retention figure of its own.** It prints
 * `retentionDays`, which is `public.audio_retention_days()` — the same function
 * that stamps `purge_after`. One number, two readers. The panel refused the
 * design's illustrative 90 before this existed and would refuse it again; what it
 * shows now is the figure the database enforces, and `retention.ts` has no
 * fallback for exactly that reason.
 *
 * **It must not soften a refusal into an empty state.** `list_audit_log` raises
 * `42501` for a non-admin rather than returning an empty page, deliberately: an
 * empty list claims there is nothing to see, a refusal claims something about who
 * is asking. The two are rendered as different sentences, and the decision lives
 * in `audit.ts` where a `.test.ts` can hold it.
 *
 * Rendered on the server with no token, as before: real console auth is this
 * app's own open question and is not invented here. Against a deployment that
 * means these two reads are refused — which is why the refusal has a rendering
 * rather than being assumed away.
 */
// Bracket access, not dot: this repo sets `noPropertyAccessFromIndexSignature`.
// The field app is the opposite case and says so — Expo rewrites `process.env.X`
// at build time and only that exact syntax — but Next reads it at runtime here, so
// the strict form is both allowed and correct.

/**
 * Both read paths REQUIRE a reason and write it to the trail before returning, so
 * this string is not decoration — it is what an auditor reads next to this
 * console's own row. It names the screen, because "why did the console read the
 * audit log" has exactly one honest answer: somebody opened the page that shows it.
 */
const READ_REASON = 'console admin screen — compliance panel render';

export const dynamic = 'force-dynamic';

export default async function Admin(): Promise<ReactNode> {
  const session = await signedIn();

  const [versions, records, audit, retention] = await Promise.all([
    session === null ? null : consentTextVersions(session.db).catch(() => null),
    session?.client.listConsentRecordsForReview({ reason: READ_REASON }).catch(() => null) ?? null,
    session?.client.listAuditLog({ reason: READ_REASON, limit: 25 }).catch(() => null) ?? null,
    session?.client.getRetentionStatus({ reason: READ_REASON }).catch(() => null) ?? null,
  ]);

  const rows =
    versions === null ? [] : versionRows(versions, records?.data ?? [], new Date().toISOString());

  const trail = audit === null ? [] : auditRows(audit);
  const hidden = audit === null ? null : hiddenRowsNote(audit);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1320 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
        <Title>Consent versions</Title>
        <Body muted>
          Every recording is stamped with the notice version the doctor actually saw. Versions are
          never edited — only superseded.
        </Body>
      </div>

      {versions === null ? (
        <MissingNote>
          The consent ledger could not be reached. Nothing below is being shown from cache — this
          table is empty because the request failed, not because there are no versions.
        </MissingNote>
      ) : null}

      <Card>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={headerCell}>Version</th>
              <th style={headerCell}>Languages</th>
              <th style={headerCell}>Hash</th>
              <th style={headerCell}>Live from</th>
              <th style={headerCell}>Consents on it</th>
              <th style={headerCell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.versionLabel}>
                <td style={{ ...cell, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {row.versionLabel}
                </td>
                <td style={cell}>{row.languages.join(' · ')}</td>
                {/*
                  The hash is on the table because it is the only column here that
                  cannot be reused or mistyped. A version label can be repeated
                  across a re-publish; a SHA-256 of the text cannot.
                */}
                <td style={{ ...cell, fontFamily: 'ui-monospace, monospace' }}>{row.hashPrefix}</td>
                <td style={cell}>{dateFrom(row.effectiveFrom)}</td>
                <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{row.consents}</td>
                <td style={cell}>
                  <Pill tone={row.live ? 'success' : 'neutral'}>
                    {row.live ? 'Live' : 'Superseded'}
                  </Pill>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={cell}>
                  <Body muted>No consent notice has been published.</Body>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      <div style={{ display: 'flex', gap: tokens.space.md, alignItems: 'stretch' }}>
        <div style={{ flex: 1.4, display: 'flex' }}>
          <Card>
            <Heading>{AUDIT_HEADING}</Heading>
            {/*
              The caveat sits above the table rather than under it. `BE-W102`: a refused
              read is not in the trail at all, so a reader who takes this for a list of
              attempts has been misled by the time they reach a footnote.
            */}
            <Body muted>{AUDIT_CAVEAT}</Body>

            {audit === null ? <MissingNote>{refusedNote()}</MissingNote> : null}

            {audit !== null && trail.length === 0 ? <Body muted>{emptyTrailNote()}</Body> : null}

            {trail.length > 0 ? (
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={headerCell}>When</th>
                    <th style={headerCell}>Who</th>
                    <th style={headerCell}>What</th>
                    <th style={headerCell}>Reason given</th>
                  </tr>
                </thead>
                <tbody>
                  {trail.map((row) => (
                    <tr key={row.id}>
                      <td style={cell}>{dateFrom(row.occurredAt)}</td>
                      <td style={cell}>{row.actorRole}</td>
                      <td style={cell}>{row.what}</td>
                      <td style={cell}>{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {hidden === null ? null : <Body muted>{hidden}</Body>}

            <Body muted>
              This carries the promise the field app already makes on its transparency screen: every
              read of an MR&apos;s data is logged and shown to that MR.
            </Body>
          </Card>
        </div>
        <div style={{ flex: 1, display: 'flex' }}>
          <Card>
            <Heading>Retention</Heading>
            <Body muted>{retentionSentence(retention)}</Body>

            {retention === null ? (
              <MissingNote>{refusedNote()}</MissingNote>
            ) : (
              <>
                <div style={{ display: 'flex', gap: tokens.space.md, flexWrap: 'wrap' }}>
                  {retentionFigures(retention).map((figure) => (
                    <div key={figure.label} style={{ minWidth: 120 }}>
                      <Label>{figure.label}</Label>
                      <Figure>{figure.value}</Figure>
                      <Body muted>{figure.note}</Body>
                    </div>
                  ))}
                </div>
                {purgeNotice(retention) === null ? null : (
                  <MissingNote>{purgeNotice(retention)}</MissingNote>
                )}
              </>
            )}

            <Label>What is already true</Label>
            <Body muted>
              Audio is purged automatically and the purge is itself logged. Changing the period
              needs written sign-off from privacy and pharmacovigilance — the two duties pull in
              opposite directions.
            </Body>
          </Card>
        </div>
      </div>
    </div>
  );
}
