import type { ReactNode } from 'react';
import { consentTextVersions } from '../../lib/consent-text';
import { signedIn } from '../../lib/session';
import { callerRole } from '../../lib/role';
import {
  Body,
  Card,
  Columns,
  Heading,
  Label,
  MissingNote,
  Page,
  PageHeader,
  Pill,
  RoleNote,
  Stat,
  Stats,
} from '../../lib/ui';
import { versionRows } from '../../lib/versions';
import {
  AUDIT_CAVEAT,
  AUDIT_HEADING,
  auditRows,
  emptyTrailNote,
  hiddenRowsNote,
  refusedNote,
  retentionRefusedNote,
} from '../../lib/audit';
import { purgeNotice, retentionFigures, retentionSentence } from '../../lib/retention';
import { indiaDate, indiaDateTime } from '../../lib/india-date';
import { whoLabel } from '../../lib/labels';

/**
 * Phase 4 E3 — consent versions, audit and retention.
 *
 * E3 shows no transcript, no analysis and no AI output at all — it is a compliance surface — so §3.6
 * never blocked it.
 *
 * **All three panels have data — `FE-W13`, MR-41 C2.** `API_PATHS.auditLog` and
 * `API_PATHS.retentionStatus` exist (`BE-W14`, `BE-W15`), and the client has `listAuditLog` and
 * `getRetentionStatus`. **A panel that says "not built" about a path that exists is the same defect
 * `FE-W10` was raised for**, one file over.
 *
 * ### The two things this screen must not do
 *
 * **It must not print a retention figure of its own.** It prints `retentionDays`, which is
 * `public.audio_retention_days()` — the same function that stamps `purge_after`. One number, two
 * readers, and `retention.ts` has no fallback for exactly that reason.
 *
 * **It must not soften a refusal into an empty state.** `list_audit_log` raises `42501` for a
 * non-admin rather than returning an empty page, deliberately: an empty list claims there is
 * nothing to see, a refusal claims something about who is asking. The decision lives in `audit.ts`
 * where a `.test.ts` can hold it.
 *
 * `FE-W164`: a manager is shown the consent versions and ONE note that the rest is an admin's,
 * instead of two red refusals — and the two reads are not asked for. `FE-W165`/`FE-W166`: the trail
 * names people, records and reasons in words, with the time in India.
 */

/**
 * Both read paths REQUIRE a reason and write it to the trail before returning, so
 * this string is not decoration — it is what an auditor reads next to this
 * console's own row. It names the screen, because "why did the console read the
 * audit log" has exactly one honest answer: somebody opened the page that shows it.
 * (`FE-W165`: the screens show it as "Opened Consent versions", `labels.ts`.)
 */
const READ_REASON = 'console admin screen — compliance panel render';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Consent versions' };

export default async function Admin(): Promise<ReactNode> {
  const session = await signedIn();
  // `FE-W164`: the trail and the retention figures are an admin's. An unknown role (`null`) still
  // asks, and the server answers.
  const role = session === null ? null : await callerRole();
  const adminView = role === null || role === 'admin';

  const [versions, records, audit, retention] = await Promise.all([
    session === null ? null : consentTextVersions(session.db).catch(() => null),
    session?.client.listConsentRecordsForReview({ reason: READ_REASON }).catch(() => null) ?? null,
    adminView
      ? (session?.client.listAuditLog({ reason: READ_REASON, limit: 25 }).catch(() => null) ?? null)
      : null,
    adminView
      ? (session?.client.getRetentionStatus({ reason: READ_REASON }).catch(() => null) ?? null)
      : null,
  ]);

  const rows =
    versions === null ? [] : versionRows(versions, records?.data ?? [], new Date().toISOString());

  const trail = audit === null ? [] : auditRows(audit);
  const hidden = audit === null ? null : hiddenRowsNote(audit);

  // `FE-W165`: who did it, by name, as `/audit` shows it — an entry carries only an id and a role.
  const actorIds = [...new Set(trail.map((row) => row.actorId))];
  const names = new Map<string, string>();
  if (session !== null && actorIds.length > 0) {
    const { data } = await session.db
      .from('user_profiles')
      .select('id, full_name')
      .in('id', actorIds);
    for (const profile of (data ?? []) as { id: string; full_name: string }[]) {
      names.set(profile.id, profile.full_name);
    }
  }

  return (
    <Page>
      <PageHeader title="Consent versions">
        <Body muted>
          Every recording is stamped with the notice version the doctor actually saw. Versions are
          never edited — only superseded.
        </Body>
      </PageHeader>

      {versions === null ? (
        <MissingNote tone="critical">
          The consent ledger could not be reached. Nothing below is being shown from cache — this
          table is empty because the request failed, not because there are no versions.
        </MissingNote>
      ) : null}

      <Card>
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Languages</th>
              <th>Fingerprint</th>
              <th>Live from</th>
              <th className="ff-num">Consents on it</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.versionLabel}>
                <td className="ff-strong">{row.versionLabel}</td>
                <td>{row.languages.join(' · ')}</td>
                {/*
                  The hash is on the table because it is the only column here that
                  cannot be reused or mistyped. A version label can be repeated
                  across a re-publish; a SHA-256 of the text cannot.
                */}
                <td className="ff-mono">{row.hashPrefix}</td>
                <td className="ff-nowrap">
                  {row.effectiveFrom === '' ? '—' : indiaDate(row.effectiveFrom)}
                </td>
                <td className="ff-num">{row.consents}</td>
                <td>
                  <Pill tone={row.live ? 'success' : 'neutral'}>
                    {row.live ? 'Live' : 'Superseded'}
                  </Pill>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="ff-empty" colSpan={6}>
                  <Body muted>No consent notice has been published.</Body>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      {adminView ? (
        <Columns>
          <div className="ff-col-wide">
            <Card>
              <Heading>{AUDIT_HEADING}</Heading>
              {/*
                The caveat sits above the table rather than under it. `BE-W102`: a refused
                read is not in the trail at all, so a reader who takes this for a list of
                attempts has been misled by the time they reach a footnote.
              */}
              <Body muted>{AUDIT_CAVEAT}</Body>

              {audit === null ? <MissingNote tone="critical">{refusedNote()}</MissingNote> : null}

              {audit !== null && trail.length === 0 ? <Body muted>{emptyTrailNote()}</Body> : null}

              {trail.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>What</th>
                      <th>Reason given</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trail.map((row) => (
                      <tr key={row.id}>
                        <td className="ff-nowrap">{indiaDateTime(row.occurredAt)}</td>
                        <td>{whoLabel(names.get(row.actorId) ?? null, row.actorRole)}</td>
                        <td>{row.what}</td>
                        <td>{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {hidden === null ? null : <Body muted>{hidden}</Body>}

              <Body muted>
                Reps are promised the same in the app: every read of a rep’s data is logged and
                shown to them. The whole trail, with filters, is in{' '}
                <a href="/audit">the audit log</a>.
              </Body>
            </Card>
          </div>
          <div>
            <Card>
              <Heading>Retention</Heading>
              <Body muted>{retentionSentence(retention)}</Body>

              {retention === null ? (
                <MissingNote tone="critical">{retentionRefusedNote()}</MissingNote>
              ) : (
                <>
                  {/* `FE-W168`: one per row in a side panel, so three never wrap two-and-one. */}
                  <Stats columns={1}>
                    {retentionFigures(retention).map((figure) => (
                      <Stat
                        key={figure.label}
                        label={figure.label}
                        note={figure.note}
                        tone={figure.tone === 'warning' ? 'attention' : 'neutral'}
                      >
                        {figure.value}
                      </Stat>
                    ))}
                  </Stats>
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
        </Columns>
      ) : (
        <RoleNote>
          Recent activity and the retention figures on this page are for admins. The consent
          versions above are the same for everyone.
        </RoleNote>
      )}
    </Page>
  );
}
