import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import type { Analysis, ConsentRecord } from '@fieldforce/core';
import { AnalysisScreen, Screen } from '@fieldforce/ui';
import type { AnalysisFinding } from '@fieldforce/ui';
import type { CitationSpanProps } from '@fieldforce/ui';
import { coachingEnabled } from '../../src/features';
import {
  AI_PROVENANCE_NOTE,
  NO_AUDIO_NOTE,
  NO_FINDINGS_NOTE,
  retentionNote,
} from '../../src/coaching/content';
import { isWorkedWell, orderedFindings, statusNote, timestampFrom } from '../../src/coaching/feed';
import { listConsentForVisit, readMyAnalysis } from '../../src/coaching/server';
import { usePulledStore } from '../../src/sync/pulled-store';
import { dayMonthIn } from '../../src/today/territory-day';

/**
 * Phase 4 D2 — one analysis and its evidence.
 *
 * **FE-D16. It reads the real server.** The analysis comes from `read_analysis` and the consent
 * line from `list_consent_records`, both the console's own functions, which an MR may call. The
 * visit and doctor come from the pulled store. It used to read the mock at `127.0.0.1:4010`.
 *
 * **Opening this screen is NOT recorded as a view, despite what this comment used to say.**
 * `read_analysis` does not stamp `mrViewedAt`; only a reply does (`audit_log.sql:487`). So the
 * screen makes no claim about who has seen the analysis first. FE-CR-9 asks backend whether
 * reading should stamp it.
 *
 * **No citation gets a play control.** `CitationSpan.onPlay` is omitted for every
 * quote, and `NO_AUDIO_NOTE` says why: this build has no audio capability, so no
 * recording was ever made. A play button that did nothing would tell the MR a
 * recording of them exists.
 */
/**
 * FE-D4 1. Unreachable unless `coachingEnabled` (off by default): a deep link lands on Today, and
 * nothing is fetched. A wrapper, so `Analysis`'s hooks never run conditionally. Nothing below is
 * changed.
 */
export default function AnalysisRoute(): ReactNode {
  return coachingEnabled ? <Analysis /> : <Redirect href="/home" />;
}

function Analysis(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { store, zone } = usePulledStore();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
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

    void readMyAnalysis(id)
      .then(async (outcome) => {
        if (stopped()) return;
        if (outcome.kind !== 'loaded') {
          setFailure(
            outcome.kind === 'refused' && outcome.refusal.code === 'not_permitted'
              ? {
                  title: 'You do not have access to this analysis',
                  detail: `The server refused this request (${outcome.refusal.sqlState}).`,
                }
              : {
                  title: 'Could not load this analysis',
                  detail:
                    outcome.kind === 'mismatch'
                      ? outcome.detail
                      : `The server refused this request (${outcome.refusal.sqlState}).`,
                },
          );
          return;
        }
        // The server answers an analysis that is not this MR's with `data: null` — an absence,
        // not an error. It is still not something to show as a blank analysis.
        if (outcome.value === null) {
          setFailure({
            title: 'This analysis is not available to you',
            detail: 'It does not exist, or it is not one of yours.',
          });
          return;
        }
        const found = outcome.value;
        setAnalysis(found);
        // Settled separately: the consent ledger being unreachable must not take the analysis
        // down with it.
        const consents = await listConsentForVisit(found.visitId).catch(() => null);
        if (stopped()) return;
        setConsent(
          (consents?.kind === 'loaded' ? consents.value : [])
            .filter((record) => !record.isWithdrawal)
            .slice()
            .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
            .at(-1) ?? null,
        );
      })
      .catch((error: unknown) => {
        if (stopped()) return;
        setFailure({
          title: 'Could not load this analysis',
          detail: error instanceof Error ? error.message : 'Unknown failure',
        });
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

  const visit = analysis === null ? undefined : store.visit.get(analysis.visitId);
  const doctor = visit === undefined ? undefined : store.doctor.get(visit.doctorId);

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
        noFindingsNote={
          analysis !== null && analysis.status === 'completed' && analysis.findings.length === 0
            ? NO_FINDINGS_NOTE
            : null
        }
        // FE-D16. AI-written, said plainly. The claims about who opened it first are gone: no
        // server record backs them (FE-CR-9).
        provenanceNote={AI_PROVENANCE_NOTE}
        reply={analysis?.mrResponse ?? null}
        statusNote={analysis === null ? null : statusNote(analysis)}
        whenLabel={visit?.startedAt == null ? 'This visit' : dayMonthIn(visit.startedAt, zone)}
      />
    </Screen>
  );
}
