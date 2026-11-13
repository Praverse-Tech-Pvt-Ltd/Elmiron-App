import type { ReactNode } from 'react';
import { ADMIN_RPC, RetentionOverviewSchema } from '@fieldforce/core';
import { signedIn } from '../../lib/session';
import { callerRole } from '../../lib/role';
import {
  Body,
  Card,
  Heading,
  MissingNote,
  Page,
  PageHeader,
  Pill,
  RoleNote,
  Stat,
  Stats,
} from '../../lib/ui';
import { adminRefusal, retentionAlerts } from '../../lib/admin-text';
import { indiaDateTime } from '../../lib/india-date';
import { tableLabel } from '../../lib/labels';
import { plural } from '../../lib/plural';

/**
 * `FE-W78` — Retention & purge, read-only.
 *
 * **Every figure is the database's.** The period is `audio_retention_days()`, the function that also
 * stamps `purge_after`; the worker's thresholds are the `app_thresholds` rows it reads; "kept for
 * good" is the list of tables `reject_mutation` actually guards. Nothing here is typed in, for the
 * reason the compliance panel gives: a screen that prints its own policy number is a second copy
 * that drifts.
 *
 * **No purge button.** The worker claims an object, deletes it from storage, then confirms
 * (`retention.yml`); it runs hourly and a second, manual worker would be a second implementation of a
 * compliance control.
 *
 * `FE-W168`: a worker that has never run is shown as "Not run yet", not as a green "Keeping up"
 * beside "Last run: never"; the overdue figure is in the attention tone when it is not zero; the 35
 * kept-for-good tables are named in words behind "Show them" rather than as a wall of `snake_case`.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Retention & purge' };

const READ_REASON = 'console retention & purge screen';

const ONLY_ADMINS =
  'Only an admin reads retention figures: they count recordings made by everyone in your company.';

const header = (
  <PageHeader title="Retention & purge">
    <Body muted>
      What is kept, for how long, and whether the worker that destroys expired audio is running.
      Read-only. Times are India time.
    </Body>
  </PageHeader>
);

export default async function RetentionPage(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  // `FE-W164`: a manager is told once, in the info tone, and nothing is asked of the server.
  const role = await callerRole();
  if (role !== null && role !== 'admin') {
    return (
      <Page>
        {header}
        <RoleNote>{ONLY_ADMINS}</RoleNote>
      </Page>
    );
  }

  const result = await session.db.rpc(ADMIN_RPC.retentionOverview, {
    p_reason: READ_REASON,
    p_runs: 20,
  });
  const parsed = result.error === null ? RetentionOverviewSchema.safeParse(result.data) : null;

  if (result.error !== null || parsed === null || !parsed.success) {
    return (
      <Page>
        {header}
        {result.error?.code === '42501' ? (
          <RoleNote>{ONLY_ADMINS}</RoleNote>
        ) : (
          <MissingNote tone="critical">
            {result.error === null
              ? 'The retention figures came back in a shape this console does not recognise, so none are shown.'
              : adminRefusal(result.error)}
          </MissingNote>
        )}
      </Page>
    );
  }

  const o = parsed.data;
  const overdue = o.yours.overdueRecordings + o.yours.overdueVoiceNotes;
  const figures = [
    { label: 'Live recordings', value: o.yours.liveRecordings, attention: false },
    { label: 'Live voice notes', value: o.yours.liveVoiceNotes, attention: false },
    { label: 'Overdue', value: overdue, attention: overdue > 0 },
    {
      label: 'Destroyed so far',
      value: o.yours.destroyedRecordings + o.yours.destroyedVoiceNotes,
      attention: false,
    },
  ];
  const neverRun = o.worker.lastRunAt === null;
  const kept = [...o.appendOnlyTables].map(tableLabel).sort((a, b) => a.localeCompare(b));

  return (
    <Page>
      {header}

      {retentionAlerts(o).map((alert) => (
        <MissingNote key={alert.text} tone={alert.tone}>
          {alert.text}
        </MissingNote>
      ))}

      <Card>
        <Heading>What is kept, and for how long</Heading>
        <table>
          <thead>
            <tr>
              <th className="ff-w-md">What</th>
              <th className="ff-w-md">Kept</th>
              <th>How</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Visit recordings and voice notes</td>
              <td>{o.retentionDays} days from when the server received them</td>
              <td>
                Destroyed by the hourly retention worker; each destruction is logged. New uploads
                are refused while the worker is stalled.
              </td>
            </tr>
            <tr>
              <td>Abandoned partial uploads</td>
              <td>Until the worker’s next run after they are abandoned</td>
              <td>Destroyed by the same worker.</td>
            </tr>
            <tr>
              <td>
                Permanent records: {plural(kept.length, 'kind of record', 'kinds of record')},
                including the audit log and consent records
              </td>
              <td>Kept; never edited or deleted, by anyone</td>
              <td>
                <div className="ff-cell-stack">
                  <span>A safeguard in the database refuses every change and every deletion.</span>
                  <details>
                    <summary>{`Show all ${String(kept.length)}`}</summary>
                    <span className="ff-muted">{kept.join(', ')}</span>
                  </details>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <Body muted>
          Changing the audio period needs written sign-off from privacy and pharmacovigilance — the
          two duties pull in opposite directions.
        </Body>
      </Card>

      <Card>
        <Heading>Your company’s audio</Heading>
        <Stats columns={4}>
          {figures.map((f) => (
            <Stat key={f.label} label={f.label} tone={f.attention ? 'attention' : 'neutral'}>
              {f.value}
            </Stat>
          ))}
        </Stats>
        {o.yours.oldestOverdueAt === null ? null : (
          <Body muted>Oldest overdue since {indiaDateTime(o.yours.oldestOverdueAt)}.</Body>
        )}
      </Card>

      <Card>
        <Heading>The retention worker</Heading>
        <div className="ff-row">
          <Pill tone={o.worker.stalled ? 'critical' : neverRun ? 'neutral' : 'success'}>
            {o.worker.stalled ? 'Stalled' : neverRun ? 'Not run yet' : 'Keeping up'}
          </Pill>
          {o.worker.lastRunAt === null ? null : (
            <Body>
              {`Last run ${indiaDateTime(o.worker.lastRunAt)} · last fully successful run ${
                o.worker.lastSuccessfulRunAt === null
                  ? 'none yet'
                  : indiaDateTime(o.worker.lastSuccessfulRunAt)
              }.`}
            </Body>
          )}
        </div>
        <Body muted>
          It destroys up to {o.thresholds.purgeBatchLimit} files per run. It counts as stalled when
          more than {o.thresholds.purgeBatchLimit * o.thresholds.purgeBacklogMultiplier} files are
          overdue, or any has been overdue for more than {o.thresholds.purgeMaxSilenceHours} hours.
          There is no manual purge here: if it stops, tell whoever runs the service for your
          company.
        </Body>
        {o.runs.length === 0 ? (
          neverRun ? null : (
            <Body muted>No run is recorded.</Body>
          )
        ) : (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Finished</th>
                <th>Outcome</th>
                <th className="ff-num">Your files destroyed</th>
              </tr>
            </thead>
            <tbody>
              {o.runs.map((run) => (
                <tr key={run.id}>
                  <td className="ff-nowrap">{indiaDateTime(run.startedAt)}</td>
                  <td className="ff-nowrap">
                    {run.finishedAt === null ? '—' : indiaDateTime(run.finishedAt)}
                  </td>
                  <td>
                    <Pill
                      tone={
                        run.outcome === 'succeeded'
                          ? 'success'
                          : run.outcome === 'failed'
                            ? 'critical'
                            : 'attention'
                      }
                    >
                      {run.outcome === 'succeeded'
                        ? 'Succeeded'
                        : run.outcome === 'failed'
                          ? 'Failed on some files'
                          : 'Did not finish'}
                    </Pill>
                  </td>
                  <td className="ff-num">{run.destroyedForYou}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Body muted>
          A run’s totals across every company are not shown: they count other companies’ audio.
        </Body>
      </Card>
    </Page>
  );
}
