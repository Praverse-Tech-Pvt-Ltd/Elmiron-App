import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Label, Secondary, Title } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { CitationSpan } from './CitationSpan';
import type { CitationSpanProps } from './CitationSpan';
import { Screen } from './Screen';
import { Spinner } from './Spinner';
import { useT } from './i18n';

/**
 * Phase 4 D2 — one analysis, with the evidence for every claim in it.
 *
 * **Every finding carries its citation and there is no shape here without one.**
 * `AnalysisFinding.citations` is a required array and `FindingCitationSchema` in
 * the contract is `.min(1)` for the same reason: a finding the MR cannot check is
 * an assertion about them that they have no way to argue with. The design calls
 * the citation "the atom of contestability" and this screen is where that is
 * either true or a slogan.
 *
 * **No quote is playable, and the screen says why rather than hiding it.**
 * `CitationSpan` takes `onPlay` as optional so a quote can stand alone once its
 * audio is purged. Nothing is passed here for a different reason — this build has
 * no audio capability at all, so no recording was ever made — and `audioNote`
 * states that. A dead play control would tell the MR a recording exists.
 *
 * **What worked comes first, and that is not decoration.** The design's shape is
 * "two worked, one to try"; leading with the improvement turns a coaching note
 * into a reprimand, and the MR stops opening the screen.
 *
 * **Nothing is truncated.** If an analysis arrives with six improvements, six are
 * shown. "Never a list of six failures" is an obligation on the rubric that
 * produces the findings, not on the screen that displays them: a screen that
 * hid one would be hiding a finding the MR has a right to contest, and the manager
 * would still see it.
 */
export interface AnalysisFinding {
  readonly id: string;
  readonly workedWell: boolean;
  /** The finding in one sentence. */
  readonly summary: string;
  /** Longer detail, when the rubric produced it. */
  readonly detail?: string;
  /** At least one. The contract enforces it; so does this type. */
  readonly citations: readonly [CitationSpanProps, ...CitationSpanProps[]];
}

export interface AnalysisScreenProps {
  readonly doctorName: string;
  /** "Thursday 14 Aug · 4 min 11 s" — formatted by the caller. */
  readonly whenLabel: string;
  /** "he agreed to recording" — the consent outcome this analysis rests on. */
  readonly consentLabel: string | null;
  readonly findings: readonly AnalysisFinding[];
  /** Why nothing can be played back. Required — see the note above. */
  readonly audioNote: string;
  /** Set when the analysis produced no findings: pending, refused or failed. */
  readonly statusNote?: string | null;
  /** The MR's reply, once written. */
  readonly reply?: string | null;
  readonly onReply: () => void;
  /** "Written by the system from the recording. Your manager has not opened this yet." */
  readonly provenanceNote: string;
  /**
   * FE-D16. Set when the analysis is complete but the server returned no findings, which the
   * real `read_analysis` does for every analysis today (FE-CR-8). Shown as its own state, so a
   * blank analysis never looks like one that found nothing to say about the visit.
   */
  readonly noFindingsNote?: string | null;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: tokens.space.xxs },
  section: { gap: tokens.space.sm },
  citations: { gap: tokens.space.xs },
});

const Findings = ({
  findings,
  heading,
}: {
  readonly findings: readonly AnalysisFinding[];
  readonly heading: string;
}): ReactNode => {
  if (findings.length === 0) return null;
  return (
    <View style={styles.section}>
      <Label muted>{heading}</Label>
      {findings.map((finding) => (
        <Card key={finding.id}>
          <BodyText>{finding.summary}</BodyText>
          {/* `FE-W178`. The finding's explanation is prose: the prose step, not `Label`. */}
          {finding.detail === undefined ? null : <Secondary>{finding.detail}</Secondary>}
          <View style={styles.citations}>
            {finding.citations.map((citation) => (
              <CitationSpan key={`${finding.id}-${citation.timestamp}`} {...citation} />
            ))}
          </View>
        </Card>
      ))}
    </View>
  );
};

export const AnalysisScreen = ({
  doctorName,
  whenLabel,
  consentLabel,
  findings,
  audioNote,
  statusNote = null,
  reply = null,
  onReply,
  provenanceNote,
  loading = false,
  failure = null,
  noFindingsNote = null,
}: AnalysisScreenProps): ReactNode => {
  const { t } = useT();
  if (failure !== null) {
    return (
      <Screen scrollable>
        <Title>{doctorName}</Title>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </Screen>
    );
  }

  const worked = findings.filter((finding) => finding.workedWell);
  const tryThis = findings.filter((finding) => !finding.workedWell);

  // `FE-W180`. The screen's one action, pinned in the reach zone as Today's and the visit's are.
  // It sat after a `flex: 1` spacer, which does nothing inside a scroll view, so on an analysis with
  // several findings "Add your reply" was at the bottom of the scroll.
  const footer =
    findings.length === 0 ? undefined : (
      <Button
        label={reply === null ? t('reply.add') : t('reply.change')}
        onPress={onReply}
        variant="primary"
      />
    );

  return (
    <Screen scrollable {...(footer === undefined ? {} : { footer })}>
      <View style={styles.head}>
        <Title>{doctorName}</Title>
        {/* `FE-W178`. The line under a screen title is `Secondary`, as on the call report. */}
        <Secondary>
          {consentLabel === null ? whenLabel : `${whenLabel} · ${consentLabel}`}
        </Secondary>
      </View>

      {loading ? <Spinner label={t('analysis.loading')} /> : null}

      {statusNote === null ? null : (
        // A refusal is not an error. The contract calls refusing correct behaviour
        // when the model cannot cite without speculating, so it reads as the system
        // declining to guess about the MR rather than as a fault.
        <Banner detail={statusNote} title={t('analysis.nothingWritten')} tone="info" />
      )}

      {noFindingsNote === null ? null : (
        <Banner detail={noFindingsNote} title={t('analysis.noFindingsTitle')} tone="info" />
      )}

      {/* The findings' own words are the model's, not the app's, and are shown as they came. */}
      <Findings findings={worked} heading={t('analysis.whatWorked')} />
      <Findings findings={tryThis} heading={t('analysis.tryNext', { count: tryThis.length })} />

      {findings.length === 0 ? null : <Secondary>{audioNote}</Secondary>}

      {reply === null ? null : (
        <Card>
          <Label muted>{t('reply.title')}</Label>
          <BodyText>{reply}</BodyText>
        </Card>
      )}

      <Card tone="quiet">
        <Secondary>{provenanceNote}</Secondary>
      </Card>
    </Screen>
  );
};
