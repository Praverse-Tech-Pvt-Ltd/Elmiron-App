import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Heading, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { CitationSpan } from './CitationSpan';
import type { CitationSpanProps } from './CitationSpan';
import { Spinner } from './Spinner';

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
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  section: { gap: tokens.space.sm },
  citations: { gap: tokens.space.xs },
  spacer: { flex: 1, minHeight: tokens.space.md },
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
          {finding.detail === undefined ? null : <Label muted>{finding.detail}</Label>}
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
}: AnalysisScreenProps): ReactNode => {
  if (failure !== null) {
    return (
      <>
        <Heading>{doctorName}</Heading>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </>
    );
  }

  const worked = findings.filter((finding) => finding.workedWell);
  const tryThis = findings.filter((finding) => !finding.workedWell);

  return (
    <>
      <View style={styles.head}>
        <Heading>{doctorName}</Heading>
        <Label muted>{consentLabel === null ? whenLabel : `${whenLabel} · ${consentLabel}`}</Label>
      </View>

      {loading ? <Spinner label="Getting this analysis" /> : null}

      {statusNote === null ? null : (
        // A refusal is not an error. The contract calls refusing correct behaviour
        // when the model cannot cite without speculating, so it reads as the system
        // declining to guess about the MR rather than as a fault.
        <Banner detail={statusNote} title="Nothing was written about this visit" tone="info" />
      )}

      <Findings findings={worked} heading="What worked" />
      <Findings
        findings={tryThis}
        heading={tryThis.length === 1 ? 'One thing to try next time' : 'Things to try next time'}
      />

      {findings.length === 0 ? null : <Label muted>{audioNote}</Label>}

      {reply === null ? null : (
        <Card>
          <Label muted>Your reply</Label>
          <BodyText>{reply}</BodyText>
        </Card>
      )}

      <View style={styles.spacer} />

      <Card tone="offline">
        <Label muted>{provenanceNote}</Label>
      </Card>

      {findings.length === 0 ? null : (
        <Button
          label={reply === null ? 'Add your reply' : 'Change your reply'}
          onPress={onReply}
          variant="primary"
        />
      )}
    </>
  );
};
