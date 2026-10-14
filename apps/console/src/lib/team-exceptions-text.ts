import type { TeamExceptionRow } from './manager-rows';
import { indiaDateTime } from './india-date';
import { words } from './labels';
import { plural } from './plural';

/**
 * `FE-W202` — the team's exceptions, in a manager's words.
 *
 * `team_exceptions` returns only what is off-plan, and its own comment is the rule this file keeps:
 * **no score, rank, percentile or ordering of reps against one another.** So reps are listed by
 * name, each with what came up for them, and nothing is counted across reps.
 *
 * **A consent-rate difference is a data-quality signal, never a judgement of the rep.** The
 * function marks it `signal: 'data_quality'` because a rep at 100% while the team sits at 40% is
 * more likely a capture problem than a triumph, and a rep far below may simply have a territory of
 * doctors who decline. The words below say that, every time the row is shown.
 *
 * Pure, so it is tested without a renderer.
 */
export interface Refusal {
  readonly code?: string | null;
  readonly message: string;
}

/** The kinds, in the order a rep's items are listed. A kind not here is listed last, in words. */
export const EXCEPTION_KINDS = [
  'missed_visits',
  'no_recent_sync',
  'high_rejection_rate',
  'consent_rate_anomaly',
  'org_default_shift_window',
] as const;

const LABELS: Readonly<Record<string, string>> = {
  missed_visits: 'Planned doctors not seen',
  no_recent_sync: 'Nothing received from the phone lately',
  high_rejection_rate: 'Many records refused',
  consent_rate_anomaly: 'Consent records look unusual',
  org_default_shift_window: 'Territory has no working hours',
};

/** What each kind means, in one sentence. Shown once on the page, for every kind. */
const MEANINGS: Readonly<Record<string, string>> = {
  missed_visits:
    'Doctors who were on the rep’s plan for the day and have no completed visit on that day.',
  no_recent_sync:
    'Nothing has reached the server from the rep’s phone for longer than your company allows, so what you see for them may be out of date; this is checked as of now, whatever day you choose.',
  high_rejection_rate:
    'An unusually large share of what the rep’s phone sent that day was refused by the server, which is worth asking about, because the cause is as often a setting as the phone.',
  consent_rate_anomaly:
    'How often doctors consented in the rep’s visits that day is far from the team’s usual figure, which is a check on the quality of the records in that territory and of the consent step, never a measure of the rep.',
  org_default_shift_window:
    'The rep’s check-ins were judged against the company’s default working hours because their territory has none of its own, which an admin sets on Territories.',
};

export const exceptionLabel = (kind: string): string => LABELS[kind] ?? words(kind);

export const exceptionMeaning = (kind: string): string =>
  MEANINGS[kind] ?? 'A check this console does not have words for yet.';

/** A data-quality signal is marked as one wherever it appears. */
export const isDataQuality = (row: Pick<TeamExceptionRow, 'kind' | 'detail'>): boolean =>
  row.kind === 'consent_rate_anomaly' || row.detail['signal'] === 'data_quality';

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const percent = (share: number): string => `${String(Math.round(share * 100))}%`;

/** The numbers behind one exception, as a sentence. Empty when the detail carries nothing usable. */
export const exceptionDetail = ({
  kind,
  detail,
}: Pick<TeamExceptionRow, 'kind' | 'detail'>): string => {
  switch (kind) {
    case 'missed_visits': {
      const missed = num(detail['missed']);
      const planned = num(detail['planned']);
      return missed === null || planned === null
        ? ''
        : `${String(missed)} of ${plural(planned, 'planned doctor', 'planned doctors')} not seen.`;
    }
    case 'no_recent_sync': {
      const at = text(detail['lastSuccessfulSyncAt']);
      const hours = num(detail['thresholdHours']);
      const limit =
        hours === null ? '' : ` Your company’s limit is ${plural(hours, 'hour', 'hours')}.`;
      return at === null
        ? `Nothing has arrived from this rep’s phone yet.${limit}`
        : `Last received ${indiaDateTime(at)}.${limit}`;
    }
    case 'high_rejection_rate': {
      const rejected = num(detail['rejected']);
      const submitted = num(detail['submitted']);
      return rejected === null || submitted === null
        ? ''
        : `${String(rejected)} of ${plural(submitted, 'record', 'records')} sent that day ${
            rejected === 1 ? 'was' : 'were'
          } refused.`;
    }
    case 'consent_rate_anomaly': {
      const rate = num(detail['rate']);
      const median = num(detail['teamMedian']);
      const size = num(detail['sampleSize']);
      return rate === null || median === null || size === null
        ? ''
        : `${percent(rate)} of ${plural(size, 'consent record', 'consent records')} that day say the doctor consented; across the team the middle figure is ${percent(median)}.`;
    }
    case 'org_default_shift_window': {
      const count = num(detail['captureCount']);
      const first = text(detail['firstAt']);
      if (count === null) return '';
      const when = first === null ? '' : `, the first on ${indiaDateTime(first)}`;
      return `${plural(count, 'check-in was', 'check-ins were')} judged this way${when}.`;
    }
    default:
      return '';
  }
};

export interface ExceptionItem {
  readonly kind: string;
  readonly label: string;
  readonly detail: string;
  readonly dataQuality: boolean;
}

export interface RepExceptions {
  readonly mrId: string;
  readonly name: string;
  readonly items: readonly ExceptionItem[];
}

const order = (kind: string): number => {
  const at = (EXCEPTION_KINDS as readonly string[]).indexOf(kind);
  return at === -1 ? EXCEPTION_KINDS.length : at;
};

/**
 * One entry per rep with anything to look at, **sorted by name** — never by how many items a rep
 * has, which would make the list a league table of who is most off-plan.
 */
export const exceptionsByRep = (
  rows: readonly TeamExceptionRow[],
  names: ReadonlyMap<string, string>,
): readonly RepExceptions[] => {
  const grouped = new Map<string, TeamExceptionRow[]>();
  for (const row of rows) grouped.set(row.mrId, [...(grouped.get(row.mrId) ?? []), row]);
  return [...grouped.entries()]
    .map(([mrId, items]) => ({
      mrId,
      name: names.get(mrId) ?? 'Unknown rep',
      items: [...items]
        .sort((a, b) => order(a.kind) - order(b.kind))
        .map((row) => ({
          kind: row.kind,
          label: exceptionLabel(row.kind),
          detail: exceptionDetail(row),
          dataQuality: isDataQuality(row),
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.mrId.localeCompare(b.mrId));
};

export const exceptionsRefusal = ({ code, message }: Refusal): string =>
  code === '28000' || /not authenticated/u.test(message)
    ? 'Your session has ended. Sign in again to see your team’s exceptions.'
    : `Your team’s exceptions could not be read. The server said: ${message}`;
