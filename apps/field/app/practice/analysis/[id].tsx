import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { PracticeAnalysisScreen, Screen } from '@fieldforce/ui';
import { practiceEnabled } from '../../../src/features';
import {
  DIMENSION_LABELS,
  PRACTICE_DIMENSIONS,
  STUB_PROVIDER,
} from '../../../src/practice/contract';
import type {
  CoachFinding,
  PracticeAnalysis,
  PracticeSession,
} from '../../../src/practice/contract';
import { practiceBackend } from '../../../src/practice/transport';

/**
 * FE-D17 — the feedback on one AI Doctor practice session.
 *
 * Every score and sentence is the backend's. A stub analysis (`modelProvider: 'stub'`: all scores
 * zero, every sentence the stub's marker) is shown as "not available", never as scores of zero.
 */
const score = (value: number): string => `${String(value)} / 100`;

const finding =
  (prefix: string) =>
  (
    row: CoachFinding,
    index: number,
  ): {
    id: string;
    title: string;
    detail: string;
    dimensionLabel: string;
    turnLabel: string;
  } => ({
    id: `${prefix}-${String(index)}`,
    title: row.title,
    detail: row.detail,
    dimensionLabel: DIMENSION_LABELS[row.dimension],
    turnLabel: `Turn ${String(row.turnIndex)}`,
  });

const PracticeAnalysisView = (): ReactNode => {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<PracticeAnalysis | null>(null);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [moduleTitles, setModuleTitles] = useState<Readonly<Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Read through a call: TypeScript narrows `cancelled` to false after the first check, and the
    // check after the await is the one that matters (see app/analysis/[id].tsx).
    const stopped = (): boolean => cancelled;
    void practiceBackend
      .readAnalysis(id)
      .then(async (found) => {
        if (stopped()) return;
        if (found === null) {
          setFailure({
            title: 'This feedback is not available to you',
            detail: 'It does not exist, or it is not about one of your practice sessions.',
          });
          return;
        }
        setAnalysis(found);
        const [theSession, titles] = await Promise.all([
          practiceBackend.readSession(found.sessionId),
          practiceBackend.moduleTitles(found.suggestedModules.map((module) => module.moduleId)),
        ]);
        if (stopped()) return;
        setSession(theSession);
        setModuleTitles(titles);
      })
      .catch((error: unknown) => {
        if (!stopped()) {
          setFailure({
            title: 'Could not load the feedback',
            detail: error instanceof Error ? error.message : 'Unknown failure',
          });
        }
      })
      .finally(() => {
        if (!stopped()) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const stub = analysis?.modelProvider === STUB_PROVIDER;

  return (
    <Screen scrollable>
      <PracticeAnalysisScreen
        dimensions={
          analysis === null
            ? []
            : PRACTICE_DIMENSIONS.map((dimension) => ({
                key: dimension,
                label: DIMENSION_LABELS[dimension],
                scoreLabel: score(analysis.dimensionScores[dimension]),
              }))
        }
        failure={failure}
        improvements={analysis?.improvements.map(finding('improvement')) ?? []}
        loading={loading}
        // A suggested module with no published title is not shown: an id is not training.
        modules={(analysis?.suggestedModules ?? []).flatMap((module) => {
          const title = moduleTitles[module.moduleId];
          return title === undefined ? [] : [{ id: module.moduleId, title, reason: module.reason }];
        })}
        notAvailable={stub}
        onOpenLearning={() => {
          router.push('/learning');
        }}
        overallLabel={analysis === null ? '' : score(analysis.overallScore)}
        personaName={session?.personaDisplayName ?? 'the AI doctor'}
        sample={analysis?.modelProvider === 'sample'}
        strengths={analysis?.strengths.map(finding('strength')) ?? []}
        summary={analysis?.summary ?? ''}
        title={session?.scenarioTitle ?? 'Practice feedback'}
      />
    </Screen>
  );
};

export default function PracticeAnalysisRoute(): ReactNode {
  return practiceEnabled ? <PracticeAnalysisView /> : <Redirect href="/home" />;
}
