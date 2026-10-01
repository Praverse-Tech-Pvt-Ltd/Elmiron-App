import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { BodyText, Heading, Label, Title } from './Text';

/**
 * FE-D17 — AI Doctor practice: choose a scenario, and see past sessions.
 *
 * No design exists in `docs/design/`; built from existing components and tokens. Scenarios are
 * the ones the rep's company has approved (four eyes, on the server); the screen adds none.
 */
export interface PracticeScenarioRow {
  readonly id: string;
  readonly title: string;
  /** "Dr Rao · Urology · sceptical", built by the route. */
  readonly personaLine: string;
  readonly objective: string;
  readonly objection: string;
}

export interface PracticeSessionRow {
  readonly sessionId: string;
  readonly title: string;
  readonly personaName: string;
  readonly stateLabel: string;
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

export const SAMPLE_PRACTICE_NOTE =
  'No AI model is connected. The practice doctor, the scenarios and the feedback here are sample data, not real practice.';

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
}: PracticeHomeScreenProps): ReactNode => (
  <View style={styles.stack}>
    <Title>Practice with the AI Doctor</Title>
    <BodyText muted>
      Practise a visit with an AI doctor, then get feedback on how it went. Only you and your
      company&apos;s admin can see your practice.
    </BodyText>

    {sample ? <Banner detail={SAMPLE_PRACTICE_NOTE} title="Sample data" tone="info" /> : null}

    {failure !== null ? (
      <Banner detail={failure.detail} title={failure.title} tone="critical" />
    ) : loading ? (
      <Spinner label="Getting your practice" />
    ) : (
      <>
        <Heading>Start a practice</Heading>
        {scenarios.length === 0 ? (
          <Card>
            <View style={styles.card}>
              <BodyText>No practice scenarios yet</BodyText>
              <Label muted>Your company approves practice scenarios before they appear here.</Label>
            </View>
          </Card>
        ) : (
          scenarios.map((row) => (
            <Card key={row.id}>
              <View style={styles.card}>
                <Heading>{row.title}</Heading>
                <Label muted>{row.personaLine}</Label>
                <BodyText>{row.objective}</BodyText>
                <Label muted>{`They will say: “${row.objection}”`}</Label>
                <Button
                  label="Start this practice"
                  loading={starting === row.id}
                  loadingLabel="Starting"
                  onPress={() => {
                    onStart(row.id);
                  }}
                  variant="secondary"
                />
              </View>
            </Card>
          ))
        )}

        <Heading>Your practice sessions</Heading>
        {sessions.length === 0 ? (
          <Card>
            <BodyText>No practice sessions yet</BodyText>
          </Card>
        ) : (
          sessions.map((row) => (
            <Card key={row.sessionId}>
              <View style={styles.card}>
                <Heading>{row.title}</Heading>
                <Label muted>{`${row.personaName} · ${row.stateLabel}`}</Label>
                {row.analysisId === null ? (
                  <Button
                    label="Open the session"
                    onPress={() => {
                      onOpenSession(row.sessionId);
                    }}
                    variant="quiet"
                  />
                ) : (
                  <Button
                    label="See the feedback"
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
