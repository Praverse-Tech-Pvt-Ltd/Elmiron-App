import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Button } from './Button';
import { Banner } from './Banner';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { BodyText, Figure, Heading, Label } from './Text';

/**
 * FE-D17 — the feedback on one AI Doctor practice session.
 *
 * The nine dimension scores (`20261001000100_coach_nine_dimensions`), strengths and improvements that each cite the turn they are about,
 * and up to three suggested modules. Every figure and sentence arrives as a prop, already the
 * server's (or the sample's, and then labelled).
 *
 * **Scores are shown to the rep, and only for practice.** By the operator's ruling of 1 October,
 * the MR and their company's admin see practice scores, and a manager sees no individual score,
 * ranking or team average. The screen says so. Nothing here compares the rep with anyone.
 */
export interface PracticeDimensionRow {
  readonly key: string;
  readonly label: string;
  readonly scoreLabel: string;
}

export interface PracticeFindingRow {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly dimensionLabel: string;
  /** "Turn 3": the turn of the conversation the finding is about. */
  readonly turnLabel: string;
}

export interface PracticeModuleRow {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
}

export interface PracticeAnalysisScreenProps {
  readonly sample: boolean;
  readonly title: string;
  readonly personaName: string;
  readonly overallLabel: string;
  readonly dimensions: readonly PracticeDimensionRow[];
  readonly strengths: readonly PracticeFindingRow[];
  readonly improvements: readonly PracticeFindingRow[];
  readonly modules: readonly PracticeModuleRow[];
  /**
   * Opens Learning, where the rep's assigned courses are. A list link rather than a deep link: the
   * suggestion names a module, and Learning shows only courses assigned to the rep.
   */
  readonly onOpenLearning?: () => void;
  readonly summary: string;
  /** No model is connected: the analysis is the stub's, and its zeros are not shown as scores. */
  readonly notAvailable?: boolean;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

export const PRACTICE_AI_NOTE =
  'Written by an AI model from your practice conversation, not by a person.';
export const PRACTICE_VISIBILITY_NOTE =
  "Only you and your company's admin can see this. Your manager does not see practice scores.";

const styles = StyleSheet.create({
  stack: { gap: tokens.space.md },
  group: { gap: tokens.space.xs },
  overall: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space.sm },
  dimension: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border,
  },
});

const Findings = ({
  heading,
  rows,
}: {
  heading: string;
  rows: readonly PracticeFindingRow[];
}): ReactNode =>
  rows.length === 0 ? null : (
    <View style={styles.group}>
      <Heading>{heading}</Heading>
      {rows.map((row) => (
        <Card key={row.id}>
          <View style={styles.group}>
            <BodyText>{row.title}</BodyText>
            <Label muted>{`${row.dimensionLabel} · ${row.turnLabel}`}</Label>
            <Label muted>{row.detail}</Label>
          </View>
        </Card>
      ))}
    </View>
  );

export const PracticeAnalysisScreen = ({
  sample,
  title,
  personaName,
  overallLabel,
  dimensions,
  strengths,
  improvements,
  modules,
  onOpenLearning,
  summary,
  notAvailable = false,
  loading = false,
  failure = null,
}: PracticeAnalysisScreenProps): ReactNode => {
  if (failure !== null) {
    return <Banner detail={failure.detail} title={failure.title} tone="critical" />;
  }
  if (loading) return <Spinner label="Getting your feedback" />;

  return (
    <View style={styles.stack}>
      <Heading>{title}</Heading>
      <Label muted>{`Practice with ${personaName}`}</Label>

      {notAvailable ? (
        <Banner
          detail="No AI model is connected to this app yet, so this practice has not been analysed. No score is shown, because none was given."
          title="Feedback is not available yet"
          tone="info"
        />
      ) : (
        <>
          {sample ? (
            <Banner
              detail="No AI model is connected. These are fixed sample values, not an assessment of what you said."
              title="Sample data"
              tone="info"
            />
          ) : null}

          <Card>
            <View style={styles.group}>
              <Label muted>Overall</Label>
              <View style={styles.overall}>
                <Figure>{overallLabel}</Figure>
              </View>
              <BodyText>{summary}</BodyText>
            </View>
          </Card>

          <View style={styles.group}>
            <Heading>By area</Heading>
            {dimensions.map((row) => (
              <View key={row.key} style={styles.dimension}>
                <BodyText>{row.label}</BodyText>
                <BodyText>{row.scoreLabel}</BodyText>
              </View>
            ))}
          </View>

          <Findings heading="What went well" rows={strengths} />
          <Findings heading="What to work on" rows={improvements} />

          {modules.length === 0 ? null : (
            <View style={styles.group}>
              <Heading>Suggested training</Heading>
              {modules.map((row) => (
                <Card key={row.id}>
                  <View style={styles.group}>
                    <BodyText>{row.title}</BodyText>
                    <Label muted>{row.reason}</Label>
                  </View>
                </Card>
              ))}
              {onOpenLearning === undefined ? null : (
                <Button label="Open Learning" onPress={onOpenLearning} variant="secondary" />
              )}
            </View>
          )}
        </>
      )}

      <Card tone="offline">
        <View style={styles.group}>
          <Label muted>{PRACTICE_AI_NOTE}</Label>
          <Label muted>{PRACTICE_VISIBILITY_NOTE}</Label>
        </View>
      </Card>
    </View>
  );
};
