import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiRequestError } from '@fieldforce/core';
import type { Analysis } from '@fieldforce/core';
import { AnalysisReplyScreen, Screen } from '@fieldforce/ui';
import { createClientForScenario } from '../../src/api';
import { NO_AUDIO_NOTE, REPLY_NOTE } from '../../src/coaching/content';
import { orderedFindings } from '../../src/coaching/feed';

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
 */
export default function ReplyRoute(): ReactNode {
  const { analysisId } = useLocalSearchParams<{ analysisId: string }>();
  const router = useRouter();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    const client = createClientForScenario();
    let cancelled = false;

    void client
      .getAnalysis(analysisId)
      .then((found) => {
        if (cancelled) return;
        setAnalysis(found);
        // An existing reply is loaded for editing rather than replaced blind: the
        // contract attaches `mrResponse` beside the findings, and an MR reopening
        // this screen is amending what they said, not starting again.
        setValue((current) => (current === '' ? (found.mrResponse ?? '') : current));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof ApiRequestError && error.code === 'permission_denied'
            ? { title: 'You do not have access to this analysis', detail: error.message }
            : {
                title: 'Could not load the finding',
                detail: error instanceof Error ? error.message : 'Unknown failure',
              },
        );
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

    void createClientForScenario()
      .respondToAnalysis(analysis.id, { response: value.trim() })
      .then(() => {
        // Back to the analysis, where the reply now appears beside the findings —
        // the MR sees where it landed rather than being told it was sent.
        router.replace(`/analysis/${analysis.id}`);
      })
      .catch((error: unknown) => {
        setFailure({
          title: 'Your reply was not sent',
          detail:
            error instanceof Error
              ? `${error.message} What you wrote is still on the screen.`
              : 'What you wrote is still on the screen.',
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
        }}
        onSaveDraft={() => {
          setSaved('Kept on this screen. It is not sent, and it is not saved if you leave.');
        }}
        onSend={send}
        replyNote={REPLY_NOTE}
        saved={saved}
        voiceNote={NO_AUDIO_NOTE}
        value={value}
      />
    </Screen>
  );
}
