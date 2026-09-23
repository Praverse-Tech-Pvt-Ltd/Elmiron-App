import type { ReactNode } from 'react';
import { signedIn } from '../../lib/session';
import { tokens } from '@fieldforce/ui-tokens';
import {
  Body,
  Card,
  Figure,
  Label,
  MissingNote,
  Pill,
  Title,
  cell,
  headerCell,
} from '../../lib/ui';
import { consentSignal, queueRows } from '../../lib/queue';

/**
 * Phase 4 E1 — the coaching queue.
 *
 * Built on 3 September 2026 under the **second** reversal of `frontend-plan-v2.md`
 * §3.6, which bans a screen that displays a transcript, analysis or AI summary.
 * The first reversal, earlier the same day, reopened the MR's own screens only and
 * explicitly left this one closed; it was reopened separately, and the scope of
 * both is written into `docs/fe-w3-spec.md`. A regulatory line that moves without
 * a record is worse than one that never moved.
 *
 * **The advisory notice is the first thing on the page and cannot be dismissed.** A
 * manager arriving here is about to read a machine's judgement of a named person.
 * The MR's reply status is a column rather than a detail on the next screen, so a
 * manager cannot open a finding without already knowing the MR answered it.
 *
 * **No ranking, and no shape that could hold one.** Rows sort by MR id, which is
 * arbitrary on purpose — §3.6's scoring ban was never part of either reversal.
 */
/**
 * MR-52 A2 — the reason every read here carries into the audit trail.
 *
 * `list_analyses` and `list_consent_records` refuse an admin who gives none, and write whatever is
 * given beside the row. It names the screen, because "why did the console read every analysis in
 * scope" has one honest answer: somebody opened the queue.
 */
const READ_REASON = 'console coaching queue — queue render';

export const dynamic = 'force-dynamic';

/** "02:14" from a millisecond offset, for a citation on a table row. */
const stamp = (startMs: number): string => {
  const total = Math.floor(startMs / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export default async function CoachingQueue(): Promise<ReactNode> {
  // MR-52 A1: the signed-in server. `null` cannot happen behind the middleware, and is handled
  // rather than asserted, because a page that throws on a signed-out render is worse than one that
  // says nothing loaded.
  const session = await signedIn();

  const [analyses, consents] = await Promise.all([
    session?.client.listAnalysesForReview({ reason: READ_REASON }).catch(() => null) ?? null,
    session?.client.listConsentRecordsForReview({ reason: READ_REASON }).catch(() => null) ?? null,
  ]);

  const rows = analyses === null ? [] : queueRows(analyses.data);
  const consent = consents === null ? null : consentSignal(consents.data);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1320 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
        <Title>Coaching queue</Title>
        <Body muted>
          Patterns that recurred across recent visits. Everyone else is not listed — that is the
          point.
        </Body>
      </div>

      <MissingNote>
        <strong>Everything below is advisory and often wrong. You decide.</strong> Each MR has
        already read their own analysis and may have replied to it. Disagreeing with a finding is a
        normal action, not an escalation, and nothing happens to anyone unless you act.
      </MissingNote>

      {analyses === null ? (
        <MissingNote>
          The analyses could not be read. This queue is empty because the request failed, not
          because nothing recurred.
        </MissingNote>
      ) : null}

      <Card>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={headerCell}>MR</th>
              <th style={headerCell}>Pattern across recent visits</th>
              <th style={headerCell}>Seen in</th>
              <th style={headerCell}>Their reply</th>
              <th style={headerCell} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.mrId}-${row.category}`}>
                <td style={{ ...cell, fontFamily: 'ui-monospace, monospace' }}>
                  {row.mrId.slice(0, 8)}
                </td>
                <td style={cell}>
                  <div>{row.pattern}</div>
                  {/*
                    The citations themselves, not a count. A manager who cannot see
                    which moments produced the pattern is being asked to trust a
                    label — and the label is the machine's.
                  */}
                  <Label>
                    {row.occurrences
                      .flatMap((occurrence) =>
                        occurrence.finding.citations.map((citation) => stamp(citation.startMs)),
                      )
                      .join(' · ')}
                  </Label>
                </td>
                <td style={cell}>
                  {row.occurrences.length} of {row.reviewed} reviewed
                </td>
                <td style={cell}>
                  {row.replied ? <Pill tone="success">Replied</Pill> : <Body muted>Not yet</Body>}
                </td>
                <td style={cell}>
                  <a
                    href={`/coaching/${row.occurrences[0]?.analysisId ?? ''}`}
                    style={{
                      background: tokens.color.textPrimary,
                      color: tokens.color.onAccent,
                      borderRadius: tokens.radius.md,
                      padding: `${String(tokens.space.sm)}px ${String(tokens.space.md)}px`,
                      textDecoration: 'none',
                    }}
                  >
                    Review
                  </a>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={cell}>
                  <Body muted>Nothing has recurred. There is no queue.</Body>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      <div style={{ display: 'flex', gap: tokens.space.md }}>
        <div style={{ flex: 1, display: 'flex' }}>
          <Card>
            <Label>Consent rate — a data-quality signal, not a performance one</Label>
            {consent === null ? (
              <MissingNote>The consent ledger could not be reached.</MissingNote>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: tokens.space.sm }}>
                  <Figure>{`${String(consent.rate)}%`}</Figure>
                  <Body muted>{`across ${String(consent.total)} answered visits`}</Body>
                </div>
                {/*
                  `manager.ts` puts this in the contract: a consent anomaly always
                  carries `signal: data_quality`, because an MR at 100% while the
                  team sits at 40% is a fraud signal rather than a win. There is
                  deliberately no per-MR rate column anywhere on this page — that is
                  a league table however it is labelled.
                */}
                {consent.perfect.length === 0 ? (
                  <Body muted>Nobody is at 100% over a meaningful number of visits.</Body>
                ) : (
                  <MissingNote>
                    {`${String(consent.perfect.length)} MR at 100%. Look at that as a possible fraud signal, not a win — a doctor who always says yes may be a doctor who was never asked.`}
                  </MissingNote>
                )}
              </>
            )}
          </Card>
        </div>
        <div style={{ flex: 1, display: 'flex' }}>
          <Card>
            <Label>Your overrides</Label>
            <MissingNote>
              Not built. There is a POST that records an override and no path that lists them back,
              so this console can write one and cannot count them.
            </MissingNote>
            <Body muted>
              {`Every override is logged and feeds the weekly rubric accuracy report. Signed in as ${session?.email ?? 'nobody — this page is not signed in'}.`}
            </Body>
          </Card>
        </div>
      </div>
    </div>
  );
}
