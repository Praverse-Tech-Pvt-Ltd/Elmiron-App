import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import type { Analysis } from '@fieldforce/core';
import { AnalysisReplyScreen, Screen } from '@fieldforce/ui';
import { coachingEnabled } from '../../src/features';
import { readMyAnalysis, respondToMyAnalysis } from '../../src/coaching/server';
import { NO_AUDIO_NOTE, REPLY_NOTE } from '../../src/coaching/content';
import { orderedFindings } from '../../src/coaching/feed';
import { failureDetail, refusedDetail } from '../../src/errors/plain';

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
  const { analysisId } = useLocalSearchParams<{ analysisId: string }>();
  const router = useRouter();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);
  // FE-D2 5. A SEND failure is not a LOAD failure. It went into `failure`, which replaces the form,
  // so the banner "What you wrote is still on the screen" appeared on a screen where it was not,
  // and nothing ever cleared it. It is its own state now: shown above the form, cleared by the
  // next edit or send.
  const [sendFailure, setSendFailure] = useState<{ title: string; detail: string } | null>(null);

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
        setFailure(
          outcome.kind === 'loaded'
            ? {
                title: 'This analysis is not available to you',
                detail: 'It does not exist, or it is not one of yours.',
              }
            : outcome.kind === 'refused' && outcome.refusal.code === 'not_permitted'
              ? {
                  title: 'You do not have access to this analysis',
                  detail: refusedDetail(outcome.refusal.sqlState),
                }
              : {
                  title: 'Could not load the finding',
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
          title: 'Could not load the finding',
          detail: failureDetail(error),
        });
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
      ? 'this analysis'
      : (orderedFindings(analysis).find((candidate) => candidate.severity !== 'info')?.title ??
        orderedFindings(analysis)[0]?.title ??
        'this analysis');

  const send = (): void => {
    if (busy || analysis === null || value.trim() === '') return;
    setBusy(true);
    setSaved(null);
    setSendFailure(null);

    void respondToMyAnalysis(analysis.id, value.trim())
      .then((outcome) => {
        if (outcome.kind === 'sent') {
          // Back to the analysis, where the reply now appears beside the findings —
          // the MR sees where it landed rather than being told it was sent.
          router.replace(`/analysis/${analysis.id}`);
          return;
        }
        setSendFailure({
          title: 'Your reply was not sent',
          detail: `${refusedDetail(outcome.refusal.sqlState)} What you wrote is still on the screen.`,
        });
      })
      .catch(() => {
        // FE-D16. No answer at all: usually no signal. Said plainly, because a rep could
        // otherwise assume it waits in the queue like a check-in does (FE-CR-10).
        setSendFailure({
          title: 'Your reply was not sent',
          detail:
            'The server could not be reached. Replies cannot be queued on this phone yet, so it is not saved. What you wrote is still on the screen: send it again when you have signal.',
        });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Screen scrollable>
      <AnalysisReplyScreen
        busy={busy}
        failure={failure}
        finding={finding}
        onChangeText={(next) => {
          setValue(next);
          setSaved(null);
          setSendFailure(null);
        }}
        onSaveDraft={() => {
          setSaved('Kept on this screen. It is not sent, and it is not saved if you leave.');
        }}
        onSend={send}
        replyNote={REPLY_NOTE}
        saved={saved}
        sendFailure={sendFailure}
        voiceNote={NO_AUDIO_NOTE}
        value={value}
      />
    </Screen>
  );
}
