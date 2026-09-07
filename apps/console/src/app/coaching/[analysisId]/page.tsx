import type { ReactNode } from 'react';
import { createApiClient } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { Body, Card, Heading, Label, MissingNote, Title } from '../../../lib/ui';
import { OverrideForm } from '../../../lib/override-form';

/**
 * Phase 4 E2 — the analysis review, and the override.
 *
 * **The override is the legally load-bearing action in this product.** It is the
 * evidence that a human read an automated judgement about an employee and made
 * their own decision, which is the thing that keeps the analysis advisory rather
 * than determinative. The design styles it as the ordinary half of an ordinary
 * decision — Agree and Disagree identical, side by side, no confirm on either —
 * and that is followed here exactly.
 *
 * **The MR's reply is on this screen and above the override.** The design's note
 * is the specification: the manager "cannot decide without having read it". It is
 * not a tab, not a disclosure, not a link — it sits between the cited moment and
 * the controls, in reading order.
 *
 * **The cited moment shows the line after it.** A quotation lifted out of its
 * answer is the easiest way for a citation to mislead, so the following segment
 * renders with it where the transcript provides one.
 *
 * Built under the second §3.6 reversal of 3 September 2026 — see
 * `docs/fe-w3-spec.md`.
 */
const baseUrl = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://127.0.0.1:4010';

export const dynamic = 'force-dynamic';

const stamp = (startMs: number): string => {
  const total = Math.floor(startMs / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export default async function Review({
  params,
}: {
  readonly params: Promise<{ readonly analysisId: string }>;
}): Promise<ReactNode> {
  const { analysisId } = await params;
  const client = createApiClient({ baseUrl, getAccessToken: () => Promise.resolve(null) });

  const analysis = await client.getAnalysis(analysisId).catch(() => null);

  if (analysis === null) {
    return (
      <div style={{ maxWidth: 900 }}>
        <Title>Review</Title>
        <MissingNote>
          This analysis could not be loaded. Nothing is shown rather than a partial view — a
          decision about somebody made from half a record is worse than no decision.
        </MissingNote>
      </div>
    );
  }

  const findings = analysis.findings.filter((finding) => finding.severity !== 'info');

  return (
    <div
      style={{ display: 'flex', gap: tokens.space.lg, maxWidth: 1320, alignItems: 'flex-start' }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: tokens.space.md }}>
        <div>
          <Label>{`Analysis ${analysis.id.slice(0, 8)} · rubric ${analysis.rubricVersion} · ${analysis.modelProvider} ${analysis.modelVersion}`}</Label>
          <Title>{findings[0]?.title ?? 'Nothing was flagged'}</Title>
        </div>

        {findings.map((finding) => (
          <Card key={finding.id}>
            <Label>The cited moment</Label>
            <Body>{finding.detail}</Body>
            {finding.citations.map((citation) => (
              <div
                key={citation.segmentId}
                style={{
                  background: tokens.color.wash,
                  borderRadius: tokens.radius.well,
                  borderLeft: `3px solid ${tokens.color.accent}`,
                  padding: tokens.space.md,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: tokens.space.xs,
                }}
              >
                <Label>{`${stamp(citation.startMs)} – ${stamp(citation.endMs)}`}</Label>
                <Body>{`“${citation.quotedText}”`}</Body>
              </div>
            ))}
            <Label>
              Transcript redacted before analysis. No patient detail reaches this screen or the
              model.
            </Label>
          </Card>
        ))}

        {/*
          The MR's reply, above the controls and never behind a disclosure. A
          manager who has not read it is deciding without the only account that
          comes from the room.
        */}
        <Card>
          <Heading>
            {analysis.mrRespondedAt === null
              ? 'The MR has not replied'
              : 'The MR replied before you opened this'}
          </Heading>
          {analysis.mrResponse === null ? (
            <Body muted>
              They have read it or will. A finding with no reply is not a finding they agree with.
            </Body>
          ) : (
            <Body>{analysis.mrResponse}</Body>
          )}
        </Card>
      </div>

      <div style={{ width: 404, flex: 'none', display: 'flex' }}>
        <OverrideForm
          analysisId={analysis.id}
          baseUrl={baseUrl}
          findingId={findings[0]?.id ?? null}
        />
      </div>
    </div>
  );
}
