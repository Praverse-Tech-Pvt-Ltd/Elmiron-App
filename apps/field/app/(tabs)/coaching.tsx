import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { ApiRequestError } from '@fieldforce/core';
import type { Analysis, Doctor, Visit } from '@fieldforce/core';
import { CoachingFeedScreen, Screen } from '@fieldforce/ui';
import type { CoachingFeedRow } from '@fieldforce/ui';
import { createClientForScenario } from '../../src/api';
import { usePulledStore } from '../../src/sync/pulled-store';
import { recentMonthsIn } from '../../src/today/server-window';
import { reviewedNote, SEEN_FIRST, TREND_NOTE } from '../../src/coaching/content';
import {
  isWorkedWell,
  orderedFindings,
  reviewedRatio,
  statusNote,
  trendFor,
} from '../../src/coaching/feed';
// MR-25 C1. This screen still READS from the mock at :4010, which sends the territory's
// own offset, so the character slice is correct here. **DELETE THE DISABLE BELOW WHEN
// THIS SCREEN IS CONVERTED** and move to dayMonthIn / clockIn with the zone from
// usePulledStore(). MR-21 converted app/visit/[id].tsx and kept clockFrom; the gotcha
// entry did not stop it, and this line sitting on the import is what will.
// eslint-disable-next-line no-restricted-imports
import { dayMonthFrom } from '../../src/doctors/profile';
// MR-25 C1. This screen still READS from the mock at :4010, which sends the territory's
// own offset, so the character slice is correct here. **DELETE THE DISABLE BELOW WHEN
// THIS SCREEN IS CONVERTED** and move to dayMonthIn / clockIn with the zone from
// usePulledStore(). MR-21 converted app/visit/[id].tsx and kept clockFrom; the gotcha
// entry did not stop it, and this line sitting on the import is what will.
// eslint-disable-next-line no-restricted-imports
import { clockFrom } from '../../src/today/plan';

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

export default function Coaching(): ReactNode {
  const router = useRouter();
  // `FE-W42` C1. Which months the trend names, from the server and in the territory.
  const { serverTime, zone } = usePulledStore();
  const [analyses, setAnalyses] = useState<readonly Analysis[]>([]);
  const [visits, setVisits] = useState<readonly Visit[]>([]);
  const [doctors, setDoctors] = useState<readonly Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    const client = createClientForScenario();
    let cancelled = false;

    void Promise.all([client.listAnalyses(), client.listVisits(), client.listDoctors()])
      .then(([analysisPage, visitPage, doctorPage]) => {
        if (cancelled) return;
        setAnalyses(analysisPage.items);
        setVisits(visitPage.items);
        setDoctors(doctorPage.items);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A denial is its own state, never an empty feed — the rule the doctors
        // screen establishes. "Nothing reviewed" and "you may not see this" look
        // identical otherwise, and only one of them is reassuring.
        setFailure(
          error instanceof ApiRequestError && error.code === 'permission_denied'
            ? { title: 'You do not have access to this coaching', detail: error.message }
            : {
                title: 'Could not load your coaching',
                detail: error instanceof Error ? error.message : 'Unknown failure',
              },
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const doctorFor = (analysis: Analysis): string => {
    const visit = visits.find((candidate) => candidate.id === analysis.visitId);
    if (visit === undefined) return 'A visit';
    return doctors.find((candidate) => candidate.id === visit.doctorId)?.fullName ?? 'A visit';
  };

  const rows: readonly CoachingFeedRow[] = analyses.map((analysis) => ({
    analysisId: analysis.id,
    doctorName: doctorFor(analysis),
    whenLabel:
      analysis.generatedAt === null ? 'Not yet written' : dayMonthFrom(analysis.generatedAt),
    findings: orderedFindings(analysis).map((finding) => ({
      id: finding.id,
      workedWell: isWorkedWell(finding),
      summary: finding.title,
    })),
    repliedLabel:
      analysis.mrRespondedAt === null ? null : `You replied · ${clockFrom(analysis.mrRespondedAt)}`,
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
