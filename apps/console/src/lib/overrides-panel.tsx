import type { ReactNode } from 'react';
import type { ApiClient, ListAnalysisOverridesResponse } from '@fieldforce/core';
import { Body, Card, Heading, Label, MissingNote } from './ui';

/**
 * `FE-W12` — the overrides already logged against an analysis (Phase 4 E1), MR-50 F2.
 *
 * The form beside it records a manager's disagreement; this shows the ones already recorded.
 * Under `C8` these rows are the human-review record SOP monitoring relies on — the evidence that a
 * person, not the model, made the decision — so a manager must see what has been decided before
 * deciding again.
 *
 * `null` means the read failed, and is said as a failure: an empty panel would read as "nobody has
 * overridden this", a claim the console cannot make when it did not get an answer.
 */
export type OverridesResult = ListAnalysisOverridesResponse | null;

/**
 * MR-51 B2. `list_analysis_overrides` writes an audit row before it answers and refuses an admin who
 * gives no reason — so without one, every admin saw "could not be loaded" against the real server
 * (the mock never asked). Sent on every read, whoever reads, the way the admin screen's
 * `READ_REASON` is: the console does not decide which roles need one. It names the screen, because
 * that is the honest answer to "why did the console read the override history".
 */
export const OVERRIDES_READ_REASON = 'console review screen — override history render';

/** The fetch, kept separate so the screen's test can prove the panel depends on it. */
export const loadOverrides = (
  client: Pick<ApiClient, 'listAnalysisOverrides'>,
  analysisId: string,
): Promise<OverridesResult> =>
  client.listAnalysisOverrides({ analysisId, reason: OVERRIDES_READ_REASON }).catch(() => null);

/** `2026-09-22T06:15:00+00:00` → `2026-09-22 06:15 UTC`. The server's instant, not the viewer's clock. */
const when = (iso: string): string => {
  const at = new Date(iso);
  return `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;
};

export const OverridesPanel = ({ result }: { readonly result: OverridesResult }): ReactNode => {
  if (result === null) {
    return (
      <MissingNote>
        The override history for this analysis could not be loaded. It is not shown as empty,
        because that would say nobody has overridden it.
      </MissingNote>
    );
  }
  if (result.data.length === 0) {
    return (
      <Card>
        <Heading>No override logged yet</Heading>
        <Body muted>Nobody has recorded a disagreement with this analysis.</Body>
      </Card>
    );
  }
  return (
    <Card>
      <Heading>{`Overrides already logged (${String(result.data.length)})`}</Heading>
      {result.data.map((override) => (
        <div key={override.id}>
          <Label>
            {`${when(override.createdAt)} · ${
              override.findingId === null ? 'the analysis as a whole' : 'one finding'
            }`}
          </Label>
          <Body>{override.reason}</Body>
        </div>
      ))}
    </Card>
  );
};
