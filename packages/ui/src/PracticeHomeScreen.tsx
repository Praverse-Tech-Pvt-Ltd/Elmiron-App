import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { BodyText, Heading, Label, Secondary, Title } from './Text';
import { t, useLanguage } from './i18n';

/**
 * FE-D17 — AI Doctor practice: choose a scenario, and see past sessions.
 *
 * No design exists in `docs/design/`; built from existing components and tokens. Scenarios are
 * the ones the rep's company has approved (four eyes, on the server); the screen adds none.
 */
export interface PracticeScenarioRow {
  readonly id: string;
  readonly title: string;
  /** "Dr Rao · Urology · Sceptical", built by the route. */
  readonly personaLine: string;
  readonly objective: string;
  readonly objection: string;
}

export interface PracticeSessionRow {
  readonly sessionId: string;
  readonly title: string;
  readonly personaName: string;
  readonly stateLabel: string;
  /**
   * `FE-W193`. "Started 15 Oct at 14:40", written by the route in the territory's clock, or null
   * when the server sent no start. Two practices of one scenario were otherwise identical rows.
   */
  readonly started?: string | null;
  readonly analysisId: string | null;
}

export interface PracticeHomeScreenProps {
  readonly sample: boolean;
  readonly scenarios: readonly PracticeScenarioRow[];
  readonly sessions: readonly PracticeSessionRow[];
  readonly onStart: (scenarioId: string) => void;
  readonly onOpenSession: (sessionId: string) => void;
  readonly onOpenAnalysis: (analysisId: string) => void;
  /** The scenario being started, while its session is created. */
  readonly starting?: string | null;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  stack: { gap: tokens.space.md },
  card: { gap: tokens.space.xs },
});

/** The sample-data note on the practice screens — a function, so it is read in the current language. */
export const samplePracticeNote = (): string => t('practice.sampleNote');

export const PracticeHomeScreen = ({
  sample,
  scenarios,
  sessions,
  onStart,
  onOpenSession,
  onOpenAnalysis,
  starting = null,
  loading = false,
  failure = null,
}: PracticeHomeScreenProps): ReactNode => {
  useLanguage();
  return (
    <View style={styles.stack}>
      <Title>{t('practice.homeTitle')}</Title>
      <BodyText muted>{t('practice.homeIntro')}</BodyText>

      {sample ? (
        <Banner detail={samplePracticeNote()} title={t('practice.sampleTitle')} tone="info" />
      ) : null}

      {failure !== null ? (
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      ) : loading ? (
        <Spinner label={t('practice.loading')} />
      ) : (
        <>
          {/*
            `FE-W178`. Section headers are muted 13.5, as the designs draw them — not `Heading`,
            which is each card's own title below and made the header read as one more card.
          */}
          <Label muted>{t('practice.startHeading')}</Label>
          {scenarios.length === 0 ? (
            <Card>
              <View style={styles.card}>
                <BodyText>{t('practice.noScenarios')}</BodyText>
                <Secondary>{t('practice.noScenariosDetail')}</Secondary>
              </View>
            </Card>
          ) : (
            scenarios.map((row) => (
              <Card key={row.id}>
                <View style={styles.card}>
                  <Heading>{row.title}</Heading>
                  <Label muted>{row.personaLine}</Label>
                  <BodyText>{row.objective}</BodyText>
                  <Secondary>{t('practice.theyWillSay', { objection: row.objection })}</Secondary>
                  <Button
                    label={t('practice.start')}
                    loading={starting === row.id}
                    loadingLabel={t('practice.starting')}
                    onPress={() => {
                      onStart(row.id);
                    }}
                    variant="secondary"
                  />
                </View>
              </Card>
            ))
          )}

          <Label muted>{t('practice.sessionsHeading')}</Label>
          {sessions.length === 0 ? (
            <Card>
              <BodyText>{t('practice.noSessions')}</BodyText>
            </Card>
          ) : (
            sessions.map((row) => (
              <Card key={row.sessionId}>
                <View style={styles.card}>
                  <Heading>{row.title}</Heading>
                  <Label muted>{`${row.personaName} · ${row.stateLabel}`}</Label>
                  {row.started === undefined || row.started === null ? null : (
                    <Secondary>{row.started}</Secondary>
                  )}
                  {row.analysisId === null ? (
                    <Button
                      label={t('practice.openSession')}
                      onPress={() => {
                        onOpenSession(row.sessionId);
                      }}
                      variant="quiet"
                    />
                  ) : (
                    <Button
                      label={t('practice.seeFeedback')}
                      onPress={() => {
                        if (row.analysisId !== null) onOpenAnalysis(row.analysisId);
                      }}
                      variant="quiet"
                    />
                  )}
                </View>
              </Card>
            ))
          )}
        </>
      )}
    </View>
  );
};
