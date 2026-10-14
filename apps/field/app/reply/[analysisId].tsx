import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import type { Analysis, Refusal } from '@fieldforce/core';
import { AnalysisReplyScreen, Screen, t, useLanguage } from '@fieldforce/ui';
import { coachingEnabled } from '../../src/features';
import { readMyAnalysis, respondToMyAnalysis } from '../../src/coaching/server';
import type { ServerRead } from '../../src/coaching/server';
import { noAudioNote, replyNote } from '../../src/coaching/content';
import { orderedFindings } from '../../src/coaching/feed';
import { failureDetail, refusedDetail } from '../../src/errors/plain';

/**
 * `FE-W158`. Why the finding could not be loaded, and why a reply was not sent, each kept as its
 * cause. The words are built from it at render, so a language chosen afterwards repaints them.
 */
type LoadFailure =
  | {
      readonly kind: 'read';
      readonly outcome: Exclude<ServerRead<Analysis | null>, { readonly kind: 'loaded' }>;
    }
  | { readonly kind: 'absent' }
  | { readonly kind: 'thrown'; readonly error: unknown };

type SendFailure =
  { readonly kind: 'refused'; readonly refusal: Refusal } | { readonly kind: 'unreachable' };

const loadFailureWords = (failure: LoadFailure): { title: string; detail: string } => {
  switch (failure.kind) {
    case 'thrown':
      return { title: t('reply.couldNotLoad'), detail: failureDetail(failure.error) };
    case 'absent':
      return { title: t('analysis.notAvailable'), detail: t('analysis.notAvailableDetail') };
    case 'read': {
      const { outcome } = failure;
      return outcome.kind === 'refused' && outcome.refusal.code === 'not_permitted'
        ? { title: t('analysis.noAccess'), detail: refusedDetail(outcome.refusal.sqlState) }
        : {
            title: t('reply.couldNotLoad'),
            detail:
              outcome.kind === 'mismatch'
                ? outcome.detail
                : refusedDetail(outcome.refusal.sqlState),
          };
    }
  }
};

const sendFailureWords = (failure: SendFailure): { title: string; detail: string } => ({
  title: t('reply.notSent'),
  detail:
    failure.kind === 'refused'
      ? `${refusedDetail(failure.refusal.sqlState)} ${t('reply.stillOnScreen')}`
      : // FE-D16. No answer at all: usually no signal. Said plainly, because a rep could
        // otherwise assume it waits in the queue like a check-in does (FE-CR-10).
        t('reply.unreachable'),
});

/**
 * Phase 4 D3 — the reply binding.
 *
 * **The draft lives on this screen and nowhere else, and that is a gap the MR is
 * told about.** The design gives the reply a draft state; the sync outbox exists
 * for work the server has not acknowledged, but a half-written sentence is not
 * work the server should ever receive — queueing it would push an unfinished
 * argument into the manager's queue the moment signal returned. So a draft is held
 * in memory and the screen says it is only kept while the screen is open, rather
 * than promising a persistence that does not exist.
 *
 * **A sent reply is not queued either.** `respondToAnalysis` returns the analysis
 * with the response attached, so the screen re-renders from the server's copy. If
 * the send fails the text stays on screen and the MR can try again — which is the
 * right failure for something they have just composed, and the wrong one for a
 * check-in, which is why this does not go through `sendOrQueue`.
 *
 * **FE-D16.** It reads the analysis through `read_analysis` and sends through
 * `respond_to_analysis`, the real functions, instead of the mock at `127.0.0.1:4010`. It still
 * cannot be queued even if that were wanted: the sync queue has no entity for a reply. FE-CR-10
 * asks backend whether it should have one. A failed send says so, and the text stays on screen.
 */
/**
 * FE-D4 1. Unreachable unless `coachingEnabled` (off by default): a deep link lands on Today, and
 * nothing is fetched. A wrapper, so `Reply`'s hooks never run conditionally. Nothing below is
 * changed.
 */
export default function ReplyRoute(): ReactNode {
  return coachingEnabled ? <Reply /> : <Redirect href="/home" />;
}

function Reply(): ReactNode {
  useLanguage();
  const { analysisId } = useLocalSearchParams<{ analysisId: string }>();
  const router = useRouter();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  /** True once "Save as a draft" is pressed; its sentence is built at render (`FE-W158`). */
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  // FE-D2 5. A SEND failure is not a LOAD failure. It went into `failure`, which replaces the form,
  // so the banner "What you wrote is still on the screen" appeared on a screen where it was not,
  // and nothing ever cleared it. It is its own state now: shown above the form, cleared by the
  // next edit or send.
  const [sendFailure, setSendFailure] = useState<SendFailure | null>(null);

  useEffect(() => {
    let cancelled = false;

    void readMyAnalysis(analysisId)
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.kind === 'loaded' && outcome.value !== null) {
          const found = outcome.value;
          setAnalysis(found);
          // An existing reply is loaded for editing rather than replaced blind: the
          // contract attaches `mrResponse` beside the findings, and an MR reopening
          // this screen is amending what they said, not starting again.
          setValue((current) => (current === '' ? (found.mrResponse ?? '') : current));
          return;
        }
        setFailure(outcome.kind === 'loaded' ? { kind: 'absent' } : { kind: 'read', outcome });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure({ kind: 'thrown', error });
      });

    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  /**
   * What the reply is answering.
   *
   * The first improvement finding, because that is what an MR opens this screen to
   * argue with. `mrResponse` is one field on the analysis rather than one per
   * finding, so the reply is against the analysis as a whole — showing the finding
   * that prompted it is context, not a claim that the reply is scoped to it.
   */
  const finding =
    analysis === null
      ? t('reply.thisAnalysis')
      : (orderedFindings(analysis).find((candidate) => candidate.severity !== 'info')?.title ??
        orderedFindings(analysis)[0]?.title ??
        t('reply.thisAnalysis'));

  const send = (): void => {
    if (busy || analysis === null || value.trim() === '') return;
    setBusy(true);
    setSaved(false);
    setSendFailure(null);

    void respondToMyAnalysis(analysis.id, value.trim())
      .then((outcome) => {
        if (outcome.kind === 'sent') {
          // Back to the analysis, where the reply now appears beside the findings —
          // the MR sees where it landed rather than being told it was sent.
          router.replace(`/analysis/${analysis.id}`);
          return;
        }
        setSendFailure({ kind: 'refused', refusal: outcome.refusal });
      })
      .catch(() => {
        // No answer at all: usually no signal (`sendFailureWords`).
        setSendFailure({ kind: 'unreachable' });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Screen scrollable>
      <AnalysisReplyScreen
        busy={busy}
        failure={failure === null ? null : loadFailureWords(failure)}
        finding={finding}
        onChangeText={(next) => {
          setValue(next);
          setSaved(false);
          setSendFailure(null);
        }}
        onSaveDraft={() => {
          setSaved(true);
        }}
        onSend={send}
        replyNote={replyNote()}
        saved={saved ? t('reply.draftKept') : null}
        sendFailure={sendFailure === null ? null : sendFailureWords(sendFailure)}
        voiceNote={noAudioNote()}
        value={value}
      />
    </Screen>
  );
}
