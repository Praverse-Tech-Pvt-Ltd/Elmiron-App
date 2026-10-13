import type { ReactNode } from 'react';
import { ADMIN_RPC, RetentionOverviewSchema } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
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
import { adminRefusal, retentionAlerts } from '../../lib/admin-text';

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
 * compliance control. If it has stopped, the fix is the workflow, and this page says so.
 */
export const dynamic = 'force-dynamic';

const READ_REASON = 'console retention & purge screen';

const dateTime = (iso: string | null): string =>
  iso === null
    ? 'never'
    : new Date(iso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      });

export default async function RetentionPage(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const result = await session.db.rpc(ADMIN_RPC.retentionOverview, {
    p_reason: READ_REASON,
    p_runs: 20,
  });
  const parsed = result.error === null ? RetentionOverviewSchema.safeParse(result.data) : null;

  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
      <Title>Retention &amp; purge</Title>
      <Body muted>
        What is kept, for how long, and whether the worker that destroys expired audio is running.
        Read-only. Times are India time.
      </Body>
    </div>
  );

  if (result.error !== null || parsed === null || !parsed.success) {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1320 }}
      >
        {header}
        <MissingNote tone="critical">
          {result.error === null
            ? 'The retention figures came back in a shape this console does not recognise, so none are shown.'
            : result.error.code === '42501'
              ? 'Only an admin reads retention status: these figures count other people’s recordings.'
              : adminRefusal(result.error)}
        </MissingNote>
      </div>
    );
  }

  const o = parsed.data;
  const figures = [
    { label: 'Live recordings', value: o.yours.liveRecordings },
    { label: 'Live voice notes', value: o.yours.liveVoiceNotes },
    { label: 'Overdue', value: o.yours.overdueRecordings + o.yours.overdueVoiceNotes },
    { label: 'Destroyed so far', value: o.yours.destroyedRecordings + o.yours.destroyedVoiceNotes },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1320 }}>
      {header}

      {retentionAlerts(o).map((alert) => (
        <MissingNote key={alert.text} tone={alert.tone}>
          {alert.text}
        </MissingNote>
      ))}

      <Card>
        <Heading>What is kept, and for how long</Heading>
        <table className="ff-table" style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={headerCell}>What</th>
              <th style={headerCell}>Kept</th>
              <th style={headerCell}>How</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>Visit recordings and voice notes</td>
              <td style={cell}>{o.retentionDays} days from when the server received them</td>
              <td style={cell}>
                Destroyed by the hourly retention worker; each destruction is logged. New uploads
                are refused while the worker is stalled.
              </td>
            </tr>
            <tr>
              <td style={cell}>Abandoned partial uploads</td>
              <td style={cell}>Until the next run after they are abandoned</td>
              <td style={cell}>Destroyed by the same worker.</td>
            </tr>
            <tr>
              <td style={cell}>
                Append-only records ({o.appendOnlyTables.length} tables, including the audit log and
                consent records)
              </td>
              <td style={cell}>Kept; never edited or deleted, by any role</td>
              <td style={cell}>
                A database trigger refuses every update and delete.
                <br />
                <span style={{ color: tokens.color.textSecondary }}>
                  {o.appendOnlyTables.join(', ')}
                </span>
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
        <div style={{ display: 'flex', gap: tokens.space.lg, flexWrap: 'wrap' }}>
          {figures.map((f) => (
            <div key={f.label} style={{ minWidth: 140 }}>
              <Label>{f.label}</Label>
              <Figure>{f.value}</Figure>
            </div>
          ))}
        </div>
        {o.yours.oldestOverdueAt === null ? null : (
          <Body muted>Oldest overdue since {dateTime(o.yours.oldestOverdueAt)}.</Body>
        )}
      </Card>

      <Card>
        <Heading>The retention worker</Heading>
        <Body>
          Last run: {dateTime(o.worker.lastRunAt)} · last fully successful run:{' '}
          {dateTime(o.worker.lastSuccessfulRunAt)} ·{' '}
          <Pill tone={o.worker.stalled ? 'critical' : 'success'}>
            {o.worker.stalled ? 'Stalled' : 'Keeping up'}
          </Pill>
        </Body>
        <Body muted>
          It destroys up to {o.thresholds.purgeBatchLimit} objects per run. It counts as stalled
          when more than {o.thresholds.purgeBatchLimit * o.thresholds.purgeBacklogMultiplier}{' '}
          objects are overdue, or any has been overdue for more than{' '}
          {o.thresholds.purgeMaxSilenceHours} hours. There is no manual purge here: if it has
          stopped, the “Audio retention” workflow is what needs attention.
        </Body>
        {o.runs.length === 0 ? (
          <Body muted>No run is recorded.</Body>
        ) : (
          <table className="ff-table" style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={headerCell}>Started</th>
                <th style={headerCell}>Finished</th>
                <th style={headerCell}>Outcome</th>
                <th style={headerCell}>Your objects destroyed</th>
              </tr>
            </thead>
            <tbody>
              {o.runs.map((run) => (
                <tr key={run.id}>
                  <td style={cell}>{dateTime(run.startedAt)}</td>
                  <td style={cell}>{run.finishedAt === null ? '—' : dateTime(run.finishedAt)}</td>
                  <td style={cell}>
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
                          ? 'Failed on some objects'
                          : 'Did not finish'}
                    </Pill>
                  </td>
                  <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>
                    {run.destroyedForYou}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Body muted>
          A run’s totals across every company are not shown: they count other companies’ audio.
        </Body>
      </Card>
    </div>
  );
}
