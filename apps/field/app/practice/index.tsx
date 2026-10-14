import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { PracticeHomeScreen, Screen, t, useLanguage } from '@fieldforce/ui';
import type { PracticeScenarioRow, PracticeSessionRow } from '@fieldforce/ui';
import { practiceEnabled } from '../../src/features';
import { practiceBackend } from '../../src/practice/transport';
import { practiceDoctorName, stanceWord } from '../../src/practice/labels';
import { failureDetail } from '../../src/errors/plain';
import { useBack } from '../../src/navigation/back';
import { usePulledStore } from '../../src/sync/pulled-store';
import { clockIn, dayMonthIn } from '../../src/today/territory-day';
import type { TerritoryZone } from '../../src/today/territory-day';
import type {
  PracticePersona,
  PracticeScenario,
  PracticeSessionSummary,
} from '../../src/practice/contract';

/**
 * FE-D17 — AI Doctor practice home: approved scenarios to start, and the rep's own sessions.
 *
 * **The real backend**, behind `practiceEnabled` (off by default) — W2-G A switched it from the
 * sample. By the operator's ruling of 1 October, this is what this release's
 * "Coaching / Analysis" means: feedback on a practice conversation, not on a recorded visit.
 */

/**
 * What the backend returned is kept, not the sentences built from it: the rows are written at
 * render, so a language change rewrites them (`FE-W158`).
 */
const scenarioRows = (
  personas: readonly PracticePersona[],
  scenarios: readonly PracticeScenario[],
): PracticeScenarioRow[] =>
  scenarios.map((scenario) => {
    const persona = personas.find((candidate) => candidate.id === scenario.personaId);
    return {
      id: scenario.id,
      title: scenario.title,
      personaLine:
        persona === undefined
          ? t('practice.aPracticeDoctor')
          : `${practiceDoctorName(persona.displayName)} · ${persona.specialty} · ${stanceWord(persona.stance)}`,
      objective: scenario.objective,
      objection: scenario.objection,
    };
  });

/**
 * `FE-W193` — when a session started, in the territory's clock: "Started 15 Oct at 14:40". Two
 * practices of the same scenario were two identical rows; the start is what tells them apart. Only
 * the server's own stamp is formatted, and a missing one shows nothing rather than a guess.
 */
const startedLabel = (startedAt: string, zone: TerritoryZone): string | null =>
  Number.isNaN(Date.parse(startedAt))
    ? null
    : t('practice.startedAt', {
        date: dayMonthIn(startedAt, zone),
        time: clockIn(startedAt, zone),
      });

const sessionRows = (
  mine: readonly PracticeSessionSummary[],
  zone: TerritoryZone,
): PracticeSessionRow[] =>
  mine.map((session) => ({
    sessionId: session.sessionId,
    title: session.scenarioTitle,
    personaName: practiceDoctorName(session.personaDisplayName),
    started: startedLabel(session.startedAt, zone),
    stateLabel:
      session.analysisId !== null
        ? t('practice.feedbackReady')
        : session.state === 'ended'
          ? t('practice.endedNoFeedback')
          : t('practice.inProgress'),
    analysisId: session.analysisId,
  }));

/** Which request failed, and with what — its title and detail are written at render. */
interface Failure {
  readonly action: 'load' | 'start';
  readonly error: unknown;
}

const PracticeHome = (): ReactNode => {
  useLanguage();
  const router = useRouter();
  const back = useBack();
  const { zone } = usePulledStore();
  const [found, setFound] = useState<{
    readonly personas: readonly PracticePersona[];
    readonly scenarios: readonly PracticeScenario[];
  }>({ personas: [], scenarios: [] });
  const [mine, setMine] = useState<readonly PracticeSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([practiceBackend.listScenarios(), practiceBackend.listMySessions()])
      .then(([listed, sessions]) => {
        if (cancelled) return;
        setFound(listed);
        setMine(sessions);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure({ action: 'load', error });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // `FE-W188`. Opened from Me: a pushed screen draws its own way back.
  return (
    <Screen onBack={back} scrollable>
      <PracticeHomeScreen
        failure={
          failure === null
            ? null
            : {
                title:
                  failure.action === 'load'
                    ? t('practice.couldNotLoad')
                    : t('practice.couldNotStart'),
                detail: failureDetail(failure.error),
              }
        }
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
              setFailure({ action: 'start', error });
            })
            .finally(() => {
              setStarting(null);
            });
        }}
        sample={false}
        scenarios={scenarioRows(found.personas, found.scenarios)}
        sessions={sessionRows(mine, zone)}
        starting={starting}
      />
    </Screen>
  );
};

export default function PracticeHomeRoute(): ReactNode {
  return practiceEnabled ? <PracticeHome /> : <Redirect href="/home" />;
}
