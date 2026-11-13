import type { ReactNode } from 'react';
import { SimCoachFindingSchema } from '@fieldforce/core';
import type { SimCoachFinding } from '@fieldforce/core';
import { signedIn } from '../../lib/session';
import { Body, Card, Heading, Label, MissingNote, Page, PageHeader, RoleNote } from '../../lib/ui';
import { callerRole } from '../../lib/role';
import { indiaDateTime } from '../../lib/india-date';
import { words } from '../../lib/labels';

/**
 * AI practice feedback, for an ADMIN — the analysis of each practice (AI Doctor) session.
 *
 * **Who sees it is RLS, not this page** (`sim_coach_analyses_read`): the rep who practised, and an
 * admin of their company. A field manager reads nothing here: individual practice scores and
 * rankings are not a manager's to see. This is PRACTICE only -- real visits are analysed elsewhere.
 *
 * Read-only. The analysis is written by the gateway's coach; nothing here edits or re-scores it.
 *
 * `FE-W165`/`FE-W166`: each card says when, in India time, and whether the feedback is sample data —
 * in those words, not as "the practice stub" or a provider's name. A finding reads as its title and
 * what it means; the dimension's stored key and the turn number are gone. `FE-W164`: a manager gets
 * the one info-tone note, with no reads asked of the server.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Practice feedback' };

/** Each finding checked against the shared contract; one that does not parse is left out, not shown raw. */
const findings = (raw: unknown): SimCoachFinding[] =>
  Array.isArray(raw)
    ? raw.flatMap((item: unknown) => {
        const parsed = SimCoachFindingSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

/** The scores as stored, whatever dimensions the database holds; non-numbers are left out. */
const scores = (raw: unknown): [string, number][] =>
  raw !== null && typeof raw === 'object'
    ? Object.entries(raw as Record<string, unknown>).flatMap(([key, value]) =>
        typeof value === 'number' ? [[key, value] as [string, number]] : [],
      )
    : [];

const FindingList = ({
  heading,
  rows,
}: {
  readonly heading: string;
  readonly rows: readonly SimCoachFinding[];
}): ReactNode => (
  <div className="ff-cell-stack">
    <Label>{heading}</Label>
    {rows.map((row) => (
      <Body key={`${row.title}-${String(row.turnIndex)}`}>
        <strong>{row.title}</strong> — {row.detail}{' '}
        <span className="ff-muted">· {words(row.dimension)}</span>
      </Body>
    ))}
  </div>
);

export default async function PracticeFeedback(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const header = (
    <PageHeader title="Practice feedback">
      <Body muted>
        The AI coach’s feedback on reps’ practice sessions with an AI doctor. Practice only — not
        real visits. Reps see their own; admins see their company’s; managers do not see these.
      </Body>
    </PageHeader>
  );

  const role = await callerRole();
  if (role !== 'admin') {
    return (
      <Page>
        {header}
        <RoleNote>
          Practice feedback is visible to the rep who practised and to admins only.
        </RoleNote>
      </Page>
    );
  }

  const [analyses, sessions, scenarios, people] = await Promise.all([
    session.db
      .from('sim_coach_analyses')
      .select(
        'id, session_id, mr_id, overall_score, dimension_scores, strengths, improvements, summary, model_provider, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(50),
    session.db.from('sim_sessions').select('id, scenario_id'),
    session.db.from('sim_scenarios').select('id, title'),
    session.db.from('user_profiles').select('id, full_name'),
  ]);

  const scenarioOf = new Map(
    (sessions.data ?? []).map((s) => [String(s.id), String(s.scenario_id)]),
  );
  const titleOf = new Map((scenarios.data ?? []).map((s) => [String(s.id), String(s.title)]));
  const nameOf = new Map((people.data ?? []).map((p) => [String(p.id), String(p.full_name)]));
  const rows = analyses.data ?? [];

  return (
    <Page>
      {header}
      {rows.length === 0 ? (
        <MissingNote tone="info">No practice session has been analysed yet.</MissingNote>
      ) : null}
      {rows.map((row) => {
        const scenario = titleOf.get(scenarioOf.get(String(row.session_id)) ?? '') ?? 'A scenario';
        const rowScores = scores(row.dimension_scores);
        return (
          <Card key={String(row.id)}>
            <Heading>{`${nameOf.get(String(row.mr_id)) ?? 'A rep'} — ${scenario}`}</Heading>
            <Body muted>
              {`${indiaDateTime(String(row.created_at))} · overall ${String(row.overall_score)} / 100${
                row.model_provider === 'stub' || row.model_provider === 'sample'
                  ? ' · sample feedback, not written by an AI model'
                  : ''
              }`}
            </Body>
            <details>
              <summary>Open the feedback</summary>
              <div className="ff-stack ff-stack-sm">
                <Body>{String(row.summary)}</Body>
                <Label>Scores</Label>
                {rowScores.map(([key, value]) => (
                  <Body key={key}>{`${words(key)}: ${String(value)} / 100`}</Body>
                ))}
                <FindingList heading="What went well" rows={findings(row.strengths)} />
                <FindingList heading="What to work on" rows={findings(row.improvements)} />
              </div>
            </details>
          </Card>
        );
      })}
    </Page>
  );
}
