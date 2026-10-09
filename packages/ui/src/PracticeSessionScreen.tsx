import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { AiAllowanceNotice } from './AiAllowanceNotice';
import type { AiAllowanceState } from './AiAllowanceNotice';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { BodyText, Heading, Label } from './Text';
import { TextField } from './TextField';
import { SAMPLE_PRACTICE_NOTE } from './PracticeHomeScreen';

/**
 * FE-D17 — one AI Doctor practice conversation.
 *
 * The doctor's turns are an AI model's text and every one says so ("AI practice doctor"). Turns
 * are numbered because the feedback cites them by number. A refusal (patient details) is a
 * designed state; "not available", offline and error are each their own banner.
 */
export interface PracticeTurnRow {
  readonly turnIndex: number;
  readonly role: 'rep' | 'doctor';
  readonly text: string;
}

export type PracticeNotice =
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'not_available' }
  | { readonly kind: 'offline'; readonly onRetry: () => void }
  | { readonly kind: 'error'; readonly onRetry: () => void };

export interface PracticeSessionScreenProps {
  readonly sample: boolean;
  readonly personaName: string;
  readonly personaLine: string;
  readonly objective: string;
  readonly objection: string;
  readonly turns: readonly PracticeTurnRow[];
  readonly draft: string;
  readonly onChangeDraft: (value: string) => void;
  readonly onSend: () => void;
  readonly sending: boolean;
  /** `open` takes turns; `ended` offers feedback. */
  readonly phase: 'open' | 'ended';
  readonly onEnd: () => void;
  readonly onGetFeedback: () => void;
  /** Ending the session, or asking for feedback. */
  readonly busy: boolean;
  readonly notice: PracticeNotice;
  readonly allowance: AiAllowanceState;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  stack: { gap: tokens.space.md },
  turn: { gap: tokens.space.xs },
  rep: { alignSelf: 'flex-end', maxWidth: '90%' },
});

const NoticeBanner = ({ notice }: { notice: PracticeNotice }): ReactNode => {
  switch (notice.kind) {
    case 'none':
      return null;
    case 'refused':
      return (
        <Card>
          <View style={styles.turn}>
            <Label muted>The practice doctor did not answer this</Label>
            <BodyText>{notice.message}</BodyText>
          </View>
        </Card>
      );
    case 'not_available':
      return (
        <Banner
          detail="No AI model is connected to this app yet, so the practice doctor cannot answer."
          title="AI Doctor practice is not available yet"
          tone="info"
        />
      );
    case 'offline':
      return (
        <Banner
          action={{ label: 'Send again', onPress: notice.onRetry }}
          detail="Your turn was not sent. Send it again when you have signal."
          title="You are offline"
          tone="offline"
        />
      );
    case 'error':
      return (
        <Banner
          action={{ label: 'Try again', onPress: notice.onRetry }}
          detail="Something went wrong on the way. Your session is still open."
          title="The practice doctor could not answer"
          tone="critical"
        />
      );
  }
};

/**
 * Standing, beside the box the rep types into: this is a rehearsal with an AI, so nothing real
 * belongs in it. Shown on every session, sample or live -- not only when something is wrong.
 */
export const PRACTICE_ONLY_NOTE =
  'Practice only — an AI plays the doctor. Do not type any real patient or doctor details.';

export const PracticeSessionScreen = ({
  sample,
  personaName,
  personaLine,
  objective,
  objection,
  turns,
  draft,
  onChangeDraft,
  onSend,
  sending,
  phase,
  onEnd,
  onGetFeedback,
  busy,
  notice,
  allowance,
  loading = false,
  failure = null,
}: PracticeSessionScreenProps): ReactNode => {
  if (failure !== null) {
    return <Banner detail={failure.detail} title={failure.title} tone="critical" />;
  }
  if (loading) return <Spinner label="Opening the practice session" />;

  const atLimit = allowance.kind === 'at_limit';
  const empty = draft.trim().length === 0;

  return (
    <View style={styles.stack}>
      <Heading>{personaName}</Heading>
      <Label muted>{personaLine}</Label>
      {sample ? <Banner detail={SAMPLE_PRACTICE_NOTE} title="Sample data" tone="info" /> : null}

      <Card>
        <View style={styles.turn}>
          <Label muted>Your aim</Label>
          <BodyText>{objective}</BodyText>
          <Label muted>They will push back with</Label>
          <BodyText>{objection}</BodyText>
        </View>
      </Card>

      <AiAllowanceNotice allowance={allowance} sample={sample} />

      {turns.map((turn) => (
        <View key={turn.turnIndex} style={turn.role === 'rep' ? styles.rep : null}>
          <Card tone={turn.role === 'doctor' ? 'hero' : 'default'}>
            <View style={styles.turn}>
              <Label muted>
                {turn.role === 'rep'
                  ? `You · turn ${String(turn.turnIndex)}`
                  : `${personaName}, AI practice doctor · turn ${String(turn.turnIndex)}`}
              </Label>
              <BodyText>{turn.text}</BodyText>
            </View>
          </Card>
        </View>
      ))}

      {sending ? <Spinner label="The practice doctor is answering" /> : null}
      <NoticeBanner notice={notice} />

      {phase === 'open' ? (
        <>
          <TextField
            editable={!sending && !atLimit}
            help={PRACTICE_ONLY_NOTE}
            label="What you say"
            onChangeText={onChangeDraft}
            value={draft}
          />
          {atLimit ? (
            <Button
              disabled
              label="Send"
              note="Unavailable until your daily allowance resets."
              onPress={onSend}
            />
          ) : empty ? (
            <Button disabled label="Send" note="Say something first." onPress={onSend} />
          ) : (
            <Button label="Send" loading={sending} loadingLabel="Sending" onPress={onSend} />
          )}
          <Button
            label="End the practice"
            loading={busy}
            loadingLabel="Ending"
            onPress={onEnd}
            variant="secondary"
          />
        </>
      ) : (
        <Button
          label="Get my feedback"
          loading={busy}
          loadingLabel="Getting your feedback"
          onPress={onGetFeedback}
        />
      )}
    </View>
  );
};
