import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { PracticeSessionScreen, Screen } from '@fieldforce/ui';
import type { AiAllowanceState, PracticeNotice } from '@fieldforce/ui';
import { practiceEnabled } from '../../../src/features';
import type { PracticeSession, TurnRequestBody } from '../../../src/practice/contract';
import {
  coachOutcome,
  coachRequestBody,
  outcomeFromThrown,
  turnOutcome,
  turnRequestBody,
} from '../../../src/practice/flow';
import { practiceBackend } from '../../../src/practice/transport';
import { failureDetail } from '../../../src/errors/plain';

/**
 * FE-D17 — one AI Doctor practice conversation.
 *
 * **What is sent is the stored session plus what the rep typed** (`turnRequestBody`). Nothing
 * from the pulled store, no real doctor, patient or visit. After each turn the session is re-read
 * from the backend, so what is on screen is what was stored, numbered as the feedback will cite it.
 */
type NoticeKind = 'none' | 'not_available' | 'offline' | 'error';

const PracticeSessionView = (): ReactNode => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeKind>('none');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<AiAllowanceState>({ kind: 'not_reported' });
  /** The turn that got no answer, so a retry sends exactly it again. */
  const [unsent, setUnsent] = useState<TurnRequestBody | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const found = await practiceBackend.readSession(id);
    if (found === null) {
      setFailure({
        title: 'This practice session is not available to you',
        detail: 'It does not exist, or it is not one of yours.',
      });
      return;
    }
    setSession(found);
  }, [id]);

  useEffect(() => {
    void reload()
      .catch((error: unknown) => {
        setFailure({
          title: 'Could not open the practice session',
          detail: failureDetail(error),
        });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [reload]);

  const sendTurn = (body: TurnRequestBody): void => {
    setSending(true);
    setNotice('none');
    setRefusal(null);
    void practiceBackend
      .turn(body)
      .then(turnOutcome, outcomeFromThrown)
      .then(async (outcome) => {
        switch (outcome.kind) {
          case 'replied':
            setUnsent(null);
            await reload();
            return;
          case 'refused':
            setUnsent(null);
            setRefusal(outcome.message);
            return;
          case 'at_limit':
            setUnsent(null);
            setAllowance({ kind: 'at_limit', resetLabel: null });
            return;
          case 'not_available':
            setUnsent(null);
            setNotice('not_available');
            return;
          case 'offline':
          case 'error':
            setUnsent(body);
            setNotice(outcome.kind);
            return;
        }
      })
      .finally(() => {
        setSending(false);
      });
  };

  const screenNotice: PracticeNotice =
    refusal !== null
      ? { kind: 'refused', message: refusal }
      : notice === 'offline' || notice === 'error'
        ? {
            kind: notice,
            onRetry: () => {
              if (unsent !== null && !sending) sendTurn(unsent);
            },
          }
        : { kind: notice };

  return (
    <Screen scrollable>
      <PracticeSessionScreen
        allowance={allowance}
        busy={busy}
        draft={draft}
        failure={failure}
        loading={loading}
        notice={screenNotice}
        objection={session?.objection ?? ''}
        objective={session?.objective ?? ''}
        onChangeDraft={setDraft}
        onEnd={() => {
          if (session === null || busy) return;
          setBusy(true);
          void practiceBackend
            .end(session.sessionId)
            .then(reload)
            .catch(() => {
              setNotice('error');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
        onGetFeedback={() => {
          if (session === null || busy) return;
          setBusy(true);
          setNotice('none');
          void practiceBackend
            .analyse(coachRequestBody(session))
            .then(coachOutcome, outcomeFromThrown)
            .then((outcome) => {
              if (outcome.kind === 'analysed') {
                router.replace(`/practice/analysis/${outcome.analysisId}`);
              } else if (outcome.kind === 'at_limit') {
                setAllowance({ kind: 'at_limit', resetLabel: null });
              } else {
                setNotice(outcome.kind);
              }
            })
            .finally(() => {
              setBusy(false);
            });
        }}
        onSend={() => {
          if (session === null || sending || allowance.kind === 'at_limit') return;
          const body = turnRequestBody(session, draft);
          if (body === null) return;
          setDraft('');
          sendTurn(body);
        }}
        personaLine={session?.scenarioTitle ?? ''}
        personaName={session?.personaDisplayName ?? ''}
        phase={session?.state === 'ended' ? 'ended' : 'open'}
        sample={false}
        sending={sending}
        turns={session?.turns ?? []}
      />
    </Screen>
  );
};

export default function PracticeSessionRoute(): ReactNode {
  return practiceEnabled ? <PracticeSessionView /> : <Redirect href="/home" />;
}
