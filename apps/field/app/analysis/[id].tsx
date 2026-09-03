import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiRequestError } from '@fieldforce/core';
import type { Analysis, ConsentRecord, Doctor, Visit } from '@fieldforce/core';
import { AnalysisScreen, Screen } from '@fieldforce/ui';
import type { AnalysisFinding } from '@fieldforce/ui';
import type { CitationSpanProps } from '@fieldforce/ui';
import { createClientForScenario } from '../../src/api';
import { NO_AUDIO_NOTE, retentionNote } from '../../src/coaching/content';
import { isWorkedWell, orderedFindings, statusNote, timestampFrom } from '../../src/coaching/feed';
import { dayMonthFrom } from '../../src/doctors/profile';

/**
 * Phase 4 D2 — one analysis and its evidence.
 *
 * **Opening this screen is an event, not a read.** `getAnalysis` is what stamps
 * `mrViewedAt` server-side, which is what turns "you see it before your manager
 * acts on it" from a claim the UI makes about itself into something the audit log
 * can support. So the analysis is fetched by id here rather than picked out of the
 * list the feed already holds.
 *
 * **No citation gets a play control.** `CitationSpan.onPlay` is omitted for every
 * quote, and `NO_AUDIO_NOTE` says why: this build has no audio capability, so no
 * recording was ever made. A play button that did nothing would tell the MR a
 * recording of them exists.
 */
export default function AnalysisRoute(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    const client = createClientForScenario();
    let cancelled = false;
    /**
     * Read through a call, not directly.
     *
     * `cancelled` is set by the cleanup below, which can run *during* the awaits in
     * this handler. TypeScript does not model that: after the first `if (cancelled)
     * return`, it narrows the variable to `false` for the rest of the closure and
     * reports every later check as dead code. The later checks are the ones that
     * matter — they are what stops a setState on an unmounted screen after a slow
     * fetch — so the value is read through a function, which is not narrowed.
     */
    const stopped = (): boolean => cancelled;

    void client
      .getAnalysis(id)
      .then(async (found) => {
        if (stopped()) return;
        setAnalysis(found);
        const [visits, doctors, consents] = await Promise.all([
          client.listVisits(),
          client.listDoctors(),
          // Settled separately: the consent ledger being unreachable must not take
          // the analysis down with it.
          client.listConsentRecords({ visitId: found.visitId }).catch(() => null),
        ]);
        if (stopped()) return;
        const theVisit = visits.items.find((candidate) => candidate.id === found.visitId) ?? null;
        setVisit(theVisit);
        setDoctor(
          theVisit === null
            ? null
            : (doctors.items.find((candidate) => candidate.id === theVisit.doctorId) ?? null),
        );
        setConsent(
          (consents?.items ?? [])
            .filter((record) => !record.isWithdrawal)
            .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
            .at(-1) ?? null,
        );
      })
      .catch((error: unknown) => {
        if (stopped()) return;
        setFailure(
          error instanceof ApiRequestError && error.code === 'permission_denied'
            ? { title: 'You do not have access to this analysis', detail: error.message }
            : {
                title: 'Could not load this analysis',
                detail: error instanceof Error ? error.message : 'Unknown failure',
              },
        );
      })
      .finally(() => {
        if (!stopped()) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * The retention sentence.
   *
   * Null rather than a computed figure: nothing in the contract returns the purge
   * date for a transcript's audio to this client, so `retentionNote(null)` says the
   * audio is gone and the transcript is what remains. That is the honest form here
   * — no recording was ever made — and the day audio capture lands, the real days
   * remaining go in and the sentence changes on its own.
   */
  const citationFor = (citation: { startMs: number; quotedText: string }): CitationSpanProps => ({
    timestamp: timestampFrom(citation.startMs),
    retention: retentionNote(null),
    quote: citation.quotedText,
  });

  /**
   * A finding with no citation is not rendered.
   *
   * `FindingCitationSchema`'s array is `.min(1)` and the contract says an empty
   * one is invalid — but Zod's minimum does not reach the TypeScript type, so a
   * server that broke the rule would arrive here as a finding with nothing behind
   * it. Showing it would put an assertion about the MR on screen that they have no
   * way to check or argue with, which is the one thing the citation exists to
   * prevent. Dropping it is the lesser harm, and the manager's side would still
   * carry the finding, so nothing is being hidden from a decision — only from a
   * screen that could not support it.
   */
  const findings: readonly AnalysisFinding[] =
    analysis === null
      ? []
      : orderedFindings(analysis).flatMap((finding) => {
          const [head, ...rest] = finding.citations;
          if (head === undefined) return [];
          const mapped: AnalysisFinding = {
            id: finding.id,
            workedWell: isWorkedWell(finding),
            summary: finding.title,
            detail: finding.detail,
            citations: [citationFor(head), ...rest.map(citationFor)],
          };
          return [mapped];
        });

  return (
    <Screen scrollable>
      <AnalysisScreen
        audioNote={NO_AUDIO_NOTE}
        consentLabel={
          consent === null
            ? null
            : consent.outcome === 'consented'
              ? 'they agreed to recording'
              : 'no recording was made'
        }
        doctorName={doctor?.fullName ?? 'This visit'}
        failure={failure}
        findings={findings}
        loading={loading}
        onReply={() => {
          router.push(`/reply/${id}`);
        }}
        provenanceNote={
          analysis === null || analysis.mrViewedAt === null
            ? 'Written by the system from the transcript. Your manager has not opened this yet.'
            : 'Written by the system from the transcript. You read it first.'
        }
        reply={analysis?.mrResponse ?? null}
        statusNote={analysis === null ? null : statusNote(analysis)}
        whenLabel={visit?.startedAt == null ? 'This visit' : dayMonthFrom(visit.startedAt)}
      />
    </Screen>
  );
}
