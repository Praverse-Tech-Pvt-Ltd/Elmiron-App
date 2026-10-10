import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { AiAllowanceNotice } from './AiAllowanceNotice';
import type { AiAllowanceState } from './AiAllowanceNotice';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { BodyText, Heading, Label, Title } from './Text';
import { TextField } from './TextField';

/**
 * FE-D15 — the rep's assistant.
 *
 * **No design exists for this in `docs/design/`.** It is composed from existing components and
 * tokens only: `Card`s for the conversation, `Banner`s for states that are not a reply, and the
 * FE-D14 `AiAllowanceNotice` for the daily limit.
 *
 * **What the rep reads is the server's reply or this screen's fixed copy, never anything else.**
 * Four kinds of thing stay visibly apart:
 *
 * - an answer (`assistant-answer`);
 * - a refusal (`assistant-refusal`), which is a designed outcome rather than an error;
 * - "not available yet", which is not a reply at all;
 * - a failure (offline or error), which offers a retry.
 *
 * With `sample`, every reply is labelled as sample data and the word "Assistant" is not used, so
 * sample text cannot be read as a real answer.
 */
export interface AssistantTurn {
  readonly id: string;
  readonly kind: 'question' | 'answer' | 'refusal';
  readonly text: string;
}

export type AssistantNotice =
  | { readonly kind: 'none' }
  | { readonly kind: 'not_available' }
  | { readonly kind: 'offline'; readonly onRetry: () => void }
  | { readonly kind: 'error'; readonly onRetry: () => void };

export interface AssistantScreenProps {
  readonly turns: readonly AssistantTurn[];
  readonly draft: string;
  readonly onChangeDraft: (value: string) => void;
  /** Sends the current draft. The route owns what is sent; this passes nothing. */
  readonly onSend: () => void;
  readonly sending: boolean;
  readonly notice: AssistantNotice;
  readonly allowance: AiAllowanceState;
  /** True when replies come from the sample fixture rather than the assistant. */
  readonly sample: boolean;
}

export const SAMPLE_REPLY_LABEL = 'Sample reply, not from the assistant';

const styles = StyleSheet.create({
  stack: { gap: tokens.space.md },
  turn: { gap: tokens.space.xs },
  question: { alignSelf: 'flex-end', maxWidth: '90%' },
});

const Turn = ({ turn, sample }: { turn: AssistantTurn; sample: boolean }): ReactNode => {
  if (turn.kind === 'question') {
    return (
      // UX polish. The rep's own words: a flat bubble on their side. "You asked" was printed above
      // every one; alignment and shape already say who spoke, so it is for screen readers only.
      <View
        accessibilityLabel={`You asked: ${turn.text}`}
        style={styles.question}
        testID="assistant-question"
      >
        <Card tone="quiet">
          <BodyText>{turn.text}</BodyText>
        </Card>
      </View>
    );
  }
  if (turn.kind === 'refusal') {
    return (
      <View testID="assistant-refusal">
        <Card>
          <View style={styles.turn}>
            <Label muted>{sample ? SAMPLE_REPLY_LABEL : 'The assistant did not answer this'}</Label>
            {sample ? <Label muted>The assistant did not answer this</Label> : null}
            <BodyText>{turn.text}</BodyText>
          </View>
        </Card>
      </View>
    );
  }
  return (
    // A raised card, not a dark hero: a long conversation was a stack of black blocks, and the
    // design keeps one hero per screen.
    <View testID="assistant-answer">
      <Card>
        <View style={styles.turn}>
          <Label muted>{sample ? SAMPLE_REPLY_LABEL : 'Assistant'}</Label>
          <BodyText>{turn.text}</BodyText>
        </View>
      </Card>
    </View>
  );
};

const NoticeBanner = ({ notice }: { notice: AssistantNotice }): ReactNode => {
  switch (notice.kind) {
    case 'none':
      return null;
    case 'not_available':
      return (
        <Banner
          detail="No AI model is connected to this app yet, so your question was not answered by anyone."
          title="The assistant is not available yet"
          tone="info"
        />
      );
    case 'offline':
      return (
        <Banner
          action={{ label: 'Send again', onPress: notice.onRetry }}
          detail="Your question was not sent. Send it again when you have signal."
          title="You are offline"
          tone="offline"
        />
      );
    case 'error':
      return (
        <Banner
          action={{ label: 'Try again', onPress: notice.onRetry }}
          detail="Something went wrong on the way, and your question was not answered."
          title="The assistant could not answer"
          tone="critical"
        />
      );
  }
};

export const AssistantScreen = ({
  turns,
  draft,
  onChangeDraft,
  onSend,
  sending,
  notice,
  allowance,
  sample,
}: AssistantScreenProps): ReactNode => {
  const atLimit = allowance.kind === 'at_limit';
  const empty = draft.trim().length === 0;

  return (
    <View style={styles.stack}>
      <Title>Ask the assistant</Title>
      <BodyText muted>
        Ask how to do something in this app: a process, a screen, a policy. It does not answer
        product or clinical questions. Do not type anything about a patient.
      </BodyText>

      {sample ? (
        <Banner
          detail="No AI model is connected. Every reply on this screen is sample data, not an answer from the assistant."
          title="Sample data"
          tone="info"
        />
      ) : null}

      <AiAllowanceNotice allowance={allowance} sample={sample} />

      {turns.length === 0 && !sending ? (
        <Card>
          <View style={styles.turn}>
            <Heading>No questions yet</Heading>
            <BodyText muted>
              Your questions and the replies appear here. Nothing is kept once you leave this
              screen.
            </BodyText>
          </View>
        </Card>
      ) : (
        turns.map((turn) => <Turn key={turn.id} sample={sample} turn={turn} />)
      )}

      {sending ? <Spinner label="Waiting for the assistant" /> : null}

      <NoticeBanner notice={notice} />

      <TextField
        editable={!sending && !atLimit}
        label="Your question"
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
        <Button disabled label="Send" note="Type a question first." onPress={onSend} />
      ) : (
        <Button
          label="Send"
          loading={sending}
          loadingLabel="Sending"
          onPress={() => {
            onSend();
          }}
        />
      )}
    </View>
  );
};
