import type { ReactNode } from 'react';
import { tokens } from '@fieldforce/ui-tokens';
import { createApiClient } from '@fieldforce/core';
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

/**
 * Phase 4 E3 — consent versions, audit and retention.
 *
 * **This is the only Phase 4 console screen that exists**, and the reason is
 * §3.6: the coaching queue (E1) and the analysis review (E2) both put an analysis
 * in front of a manager, which the 3 September decision did not reopen. E3 shows
 * no transcript, no analysis and no AI output at all — it is a compliance surface
 * — so it was never blocked.
 *
 * **One of its three panels has data and two do not.** The consent-version table
 * is real, read from the ledger. There is no audit-log path and no retention path
 * in `API_PATHS`, so those panels say what is missing and name it, rather than
 * printing the design's illustrative "41 recordings purged" and "90 days" as
 * though the server had said them.
 *
 * Rendered on the server with no token: `/consent-text-versions` and
 * `/consent-records` are what the mock serves unauthenticated today. Real auth is
 * the console's own open question and is not invented here.
 */
// Bracket access, not dot: this repo sets `noPropertyAccessFromIndexSignature`.
// The field app is the opposite case and says so — Expo rewrites `process.env.X`
// at build time and only that exact syntax — but Next reads it at runtime here, so
// the strict form is both allowed and correct.
const baseUrl = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://127.0.0.1:4010';

export const dynamic = 'force-dynamic';

export default async function Admin(): Promise<ReactNode> {
  const client = createApiClient({ baseUrl, getAccessToken: () => Promise.resolve(null) });

  const [versions, records] = await Promise.all([
    client.listConsentTextVersions().catch(() => null),
    client.listConsentRecords().catch(() => null),
  ]);

  const rows =
    versions === null
      ? []
      : versionRows(versions.items, records?.items ?? [], new Date().toISOString());

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
          The consent ledger could not be reached at {baseUrl}. Nothing below is being shown from
          cache — this table is empty because the request failed, not because there are no versions.
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
            <Heading>Audit log</Heading>
            <MissingNote>
              Not built. The audit log exists — `audit_log` is append-only and written by trigger on
              every table this console touches — but no path in `API_PATHS` exposes it, so there is
              nothing to read. The design&apos;s panel would otherwise be four invented lines.
            </MissingNote>
            <Body muted>
              When it lands it carries the promise the field app already makes on its transparency
              screen: every read of an MR&apos;s data is logged and shown to that MR.
            </Body>
          </Card>
        </div>
        <div style={{ flex: 1, display: 'flex' }}>
          <Card>
            <Heading>Retention</Heading>
            <MissingNote>
              Not built. The retention schedule is server-side and no endpoint returns it. The
              design shows 90 days; printing that here would be this console asserting a policy
              value it has not been told.
            </MissingNote>
            <Label>What is already true</Label>
            <Body muted>
              Audio is purged automatically and the purge is itself logged. Changing the period
              needs written sign-off from privacy and pharmacovigilance — the two duties pull in
              opposite directions.
            </Body>
          </Card>
        </div>
      </div>

      <Card>
        <Heading>The manager console is not here</Heading>
        <Body muted>
          Phase 4&apos;s coaching queue and analysis review both put an AI analysis of a named
          employee in front of their manager. §3.6 forbids that and the 3 September decision
          reopened only the MR&apos;s own screens. See docs/fe-w3-spec.md.
        </Body>
        <div>
          <Figure>1</Figure>{' '}
          <Label>of 6 Phase 4 screens is a console screen that may be built</Label>
        </div>
      </Card>
    </div>
  );
}
