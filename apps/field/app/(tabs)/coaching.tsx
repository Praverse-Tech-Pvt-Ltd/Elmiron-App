import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useRouter } from 'expo-router';
import type { Analysis } from '@fieldforce/core';
import { CoachingFeedScreen, Screen } from '@fieldforce/ui';
import type { CoachingFeedRow } from '@fieldforce/ui';
import { coachingEnabled } from '../../src/features';
import { usePulledStore } from '../../src/sync/pulled-store';
import { visitsFromStore } from '../../src/sync/selectors';
import { recentMonthsIn } from '../../src/today/server-window';
import { clockIn, dayMonthIn } from '../../src/today/territory-day';
import {
  COACHING_UNAVAILABLE,
  reviewedNote,
  SEEN_FIRST,
  TREND_NOTE,
} from '../../src/coaching/content';
import {
  isWorkedWell,
  orderedFindings,
  reviewedRatio,
  statusNote,
  trendFor,
} from '../../src/coaching/feed';
import { loadRecordingEnabled } from '../../src/coaching/recording-flag';
import { listMyAnalyses } from '../../src/coaching/server';
import { failureDetail, refusedDetail } from '../../src/errors/plain';

/**
 * Phase 4 D1 — the Coaching tab.
 *
 * This tab was a deliberate placeholder for three phases: `frontend-plan-v2.md`
 * §3.6 lists "any screen that displays a transcript, analysis or AI summary" under
 * *never build*, and the line was upheld on 2 September 2026. It was reopened for
 * the MR-facing screens on 3 September — recorded in `docs/fe-w3-spec.md` §4a with
 * the scope of the reversal, because a regulatory line that moves silently is
 * worse than one that never moved.
 *
 * **The half of §3.6 that bans a score was not reopened and is not touched here.**
 * The only number this screen renders is a count of one behaviour against the same
 * MR's own previous months.
 */
const MONTHS_SHOWN = 3;

/**
 * FE-D4 1. Unreachable unless `coachingEnabled` (off by default): the tab is hidden, and a deep
 * link lands on Today. A wrapper rather than an early return, so `CoachingFeed`'s hooks never run
 * conditionally. Nothing below is changed.
 */
export default function Coaching(): ReactNode {
  return coachingEnabled ? <CoachingFeed /> : <Redirect href="/home" />;
}

function CoachingFeed(): ReactNode {
  const router = useRouter();
  // `FE-W42` C1. Which months the trend names, from the server and in the territory.
  const { serverTime, zone, store } = usePulledStore();
  const [analyses, setAnalyses] = useState<readonly Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);
  /** The build's recording switch, read lazily (`src/coaching/recording-flag.ts`). */
  const [recordingEnabled, setRecordingEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    /**
     * FE-D16. The MR's own analyses from `list_analyses`, the real function, which CR-3 found an
     * MR may call. It used to read `GET /analyses` on the mock at `127.0.0.1:4010`.
     */
    void listMyAnalyses()
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.kind === 'loaded') {
          setAnalyses(outcome.value);
          return;
        }
        // A denial is its own state, never an empty feed — the rule the doctors screen
        // establishes. "Nothing reviewed" and "you may not see this" look identical otherwise,
        // and only one of them is reassuring. A mismatch is a failure too: an answer this app
        // cannot read is not an empty one.
        setFailure(
          outcome.kind === 'refused' && outcome.refusal.code === 'not_permitted'
            ? {
                title: 'You do not have access to this coaching',
                detail: refusedDetail(outcome.refusal.sqlState),
              }
            : {
                title: 'Could not load your coaching',
                detail:
                  outcome.kind === 'mismatch'
                    ? outcome.detail
                    : refusedDetail(outcome.refusal.sqlState),
              },
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure({
          title: 'Could not load your coaching',
          detail: failureDetail(error),
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void loadRecordingEnabled().then((enabled) => {
      if (!cancelled) setRecordingEnabled(enabled);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // The visit and the doctor come from the pulled store, the source every other screen reads.
  const visits = visitsFromStore(store);
  const doctorFor = (analysis: Analysis): string => {
    const visit = store.visit.get(analysis.visitId);
    if (visit === undefined) return 'A visit';
    return store.doctor.get(visit.doctorId)?.fullName ?? 'A visit';
  };

  const rows: readonly CoachingFeedRow[] = analyses.map((analysis) => ({
    analysisId: analysis.id,
    doctorName: doctorFor(analysis),
    whenLabel:
      analysis.generatedAt === null ? 'Not yet written' : dayMonthIn(analysis.generatedAt, zone),
    findings: orderedFindings(analysis).map((finding) => ({
      id: finding.id,
      workedWell: isWorkedWell(finding),
      summary: finding.title,
    })),
    repliedLabel:
      analysis.mrRespondedAt === null
        ? null
        : `You replied · ${clockIn(analysis.mrRespondedAt, zone)}`,
    statusNote: statusNote(analysis),
  }));

  const ratio = reviewedRatio(analyses, visits);
  /**
   * **`FE-W42` C1. Which months the trend covers, from the server and in the territory.**
   *
   * An empty list when no server clock is known, so `trendFor` produces no points and the
   * chart renders nothing. That is the honest outcome: a trend is a claim about named
   * months, and naming the wrong three is worse than naming none -- an MR comparing
   * "August" against a month the app picked from a drifted handset is reading a chart whose
   * axis is wrong, with nothing on screen saying so.
   */
  const months = serverTime === null ? [] : recentMonthsIn(serverTime, zone, MONTHS_SHOWN);
  const points = trendFor(analyses, 'objection_handling', months);

  return (
    <Screen scrollable>
      <CoachingFeedScreen
        failure={failure}
        loading={loading}
        onOpen={(id) => {
          router.push(`/analysis/${id}`);
        }}
        onReply={(id) => {
          router.push(`/reply/${id}`);
        }}
        periodLabel="Your coaching"
        reviewedNote={reviewedNote(ratio.reviewed, ratio.total)}
        rows={rows}
        seenFirstNote={SEEN_FIRST}
        // FE-D16. With recording off in this build, no analysis can be made, and the feed says so
        // rather than looking like a working feed with nothing in it yet.
        unavailable={recordingEnabled === false ? COACHING_UNAVAILABLE : null}
        {...(points.some((point) => point.count > 0)
          ? {
              trend: {
                caption: 'Objections you answered, month by month',
                points,
                note: TREND_NOTE,
              },
            }
          : {})}
      />
    </Screen>
  );
}
