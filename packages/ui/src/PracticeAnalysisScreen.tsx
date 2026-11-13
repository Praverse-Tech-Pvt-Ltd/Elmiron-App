import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Button } from './Button';
import { Banner } from './Banner';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { BodyText, Figure, Label, Secondary, Title } from './Text';
import { t, useLanguage } from './i18n';

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

/** Functions, not strings, so each is read in the current language (`FE-W158`). */
export const practiceAiNote = (): string => t('practice.aiNote');
export const practiceVisibilityNote = (): string => t('practice.visibilityNote');

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
  // `FE-W179`. The area's name takes the room and wraps; its score keeps its width.
  dimensionName: { flex: 1 },
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
      {/* `FE-W178`. A section header: muted 13.5, as the designs draw every one. */}
      <Label muted>{heading}</Label>
      {rows.map((row) => (
        <Card key={row.id}>
          <View style={styles.group}>
            <BodyText>{row.title}</BodyText>
            <Label muted>{`${row.dimensionLabel} · ${row.turnLabel}`}</Label>
            {/* The explanation is the useful part: prose size, not the 13.5 label step. */}
            <Secondary muted={false}>{row.detail}</Secondary>
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
  useLanguage();
  if (failure !== null) {
    return <Banner detail={failure.detail} title={failure.title} tone="critical" />;
  }
  if (loading) return <Spinner label={t('practice.gettingFeedback')} />;

  return (
    <View style={styles.stack}>
      <Title>{title}</Title>
      {/* `FE-W178`. The line under a screen title is `Secondary`, as on the call report. */}
      <Secondary>{t('practice.practiceWith', { name: personaName })}</Secondary>

      {notAvailable ? (
        <Banner
          detail={t('practice.feedbackNotAvailableDetail')}
          title={t('practice.feedbackNotAvailableTitle')}
          tone="info"
        />
      ) : (
        <>
          {sample ? (
            <Banner
              detail={t('practice.analysisSampleDetail')}
              title={t('practice.sampleTitle')}
              tone="info"
            />
          ) : null}

          <Card>
            <View style={styles.group}>
              <Label muted>{t('practice.overall')}</Label>
              <View style={styles.overall}>
                <Figure>{overallLabel}</Figure>
              </View>
              <BodyText>{summary}</BodyText>
            </View>
          </Card>

          <Findings heading={t('practice.wentWell')} rows={strengths} />
          <Findings heading={t('practice.workOn')} rows={improvements} />

          {modules.length === 0 ? null : (
            <View style={styles.group}>
              <Label muted>{t('practice.suggestedTraining')}</Label>
              {modules.map((row) => (
                <Card key={row.id}>
                  <View style={styles.group}>
                    <BodyText>{row.title}</BodyText>
                    <Secondary>{row.reason}</Secondary>
                  </View>
                </Card>
              ))}
              {onOpenLearning === undefined ? null : (
                <Button
                  label={t('practice.openLearning')}
                  onPress={onOpenLearning}
                  variant="secondary"
                />
              )}
            </View>
          )}

          {/* UX polish: what worked and what to try lead; the numbers follow them. */}
          <View style={styles.group}>
            <Label muted>{t('practice.scoresByArea')}</Label>
            {dimensions.map((row) => (
              <View key={row.key} style={styles.dimension}>
                <View style={styles.dimensionName}>
                  <BodyText>{row.label}</BodyText>
                </View>
                <BodyText>{row.scoreLabel}</BodyText>
              </View>
            ))}
          </View>
        </>
      )}

      <Card tone="quiet">
        <View style={styles.group}>
          <Secondary>{practiceAiNote()}</Secondary>
          <Secondary>{practiceVisibilityNote()}</Secondary>
        </View>
      </Card>
    </View>
  );
};
