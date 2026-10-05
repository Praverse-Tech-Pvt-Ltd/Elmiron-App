import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { PracticeHomeScreen, Screen } from '@fieldforce/ui';
import type { PracticeScenarioRow, PracticeSessionRow } from '@fieldforce/ui';
import { practiceSampleEnabled } from '../../src/features';
import { practiceBackend } from '../../src/practice/transport';

/**
 * FE-D17 — AI Doctor practice home: approved scenarios to start, and the rep's own sessions.
 *
 * **Sample data only**, behind `practiceSampleEnabled` (off by default), until FE-CR-11 lands the
 * practice contract on `main`. By the operator's ruling of 1 October, this is what this release's
 * "Coaching / Analysis" means: feedback on a practice conversation, not on a recorded visit.
 */
const STANCE: Readonly<Record<string, string>> = {
  receptive: 'receptive',
  sceptical: 'sceptical',
  rushed: 'in a hurry',
  hostile: 'hostile',
};

const PracticeHome = (): ReactNode => {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<readonly PracticeScenarioRow[]>([]);
  const [sessions, setSessions] = useState<readonly PracticeSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([practiceBackend.listScenarios(), practiceBackend.listMySessions()])
      .then(([{ personas, scenarios: found }, mine]) => {
        if (cancelled) return;
        setScenarios(
          found.map((scenario) => {
            const persona = personas.find((candidate) => candidate.id === scenario.personaId);
            return {
              id: scenario.id,
              title: scenario.title,
              personaLine:
                persona === undefined
                  ? 'A practice doctor'
                  : `${persona.displayName} · ${persona.specialty} · ${STANCE[persona.stance] ?? persona.stance}`,
              objective: scenario.objective,
              objection: scenario.objection,
            };
          }),
        );
        setSessions(
          mine.map((session) => ({
            sessionId: session.sessionId,
            title: session.scenarioTitle,
            personaName: session.personaDisplayName,
            stateLabel:
              session.analysisId !== null
                ? 'Feedback ready'
                : session.state === 'ended'
                  ? 'Ended, no feedback yet'
                  : 'In progress',
            analysisId: session.analysisId,
          })),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailure({
            title: 'Could not load practice',
            detail: error instanceof Error ? error.message : 'Unknown failure',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen scrollable>
      <PracticeHomeScreen
        failure={failure}
        loading={loading}
        onOpenAnalysis={(analysisId) => {
          router.push(`/practice/analysis/${analysisId}`);
        }}
        onOpenSession={(sessionId) => {
          router.push(`/practice/session/${sessionId}`);
        }}
        onStart={(scenarioId) => {
          if (starting !== null) return;
          setStarting(scenarioId);
          void practiceBackend
            .start(scenarioId)
            .then((started) => {
              router.push(`/practice/session/${started.sessionId}`);
            })
            .catch((error: unknown) => {
              setFailure({
                title: 'Could not start the practice',
                detail: error instanceof Error ? error.message : 'Unknown failure',
              });
            })
            .finally(() => {
              setStarting(null);
            });
        }}
        sample
        scenarios={scenarios}
        sessions={sessions}
        starting={starting}
      />
    </Screen>
  );
};

export default function PracticeHomeRoute(): ReactNode {
  return practiceSampleEnabled ? <PracticeHome /> : <Redirect href="/home" />;
}
