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
import { t, useLanguage } from './i18n';

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

/** The label on a sample reply — a function, so it is read in the current language. */
export const sampleReplyLabel = (): string => t('assistant.sampleReply');

const styles = StyleSheet.create({
  stack: { gap: tokens.space.md },
  turn: { gap: tokens.space.xs },
  question: { alignSelf: 'flex-end', maxWidth: '90%' },
});

const Turn = ({ turn, sample }: { turn: AssistantTurn; sample: boolean }): ReactNode => {
  useLanguage();
  if (turn.kind === 'question') {
    return (
      // UX polish. The rep's own words: a flat bubble on their side. "You asked" was printed above
      // every one; alignment and shape already say who spoke, so it is for screen readers only.
      <View
        accessibilityLabel={t('assistant.youAsked', { question: turn.text })}
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
            <Label muted>{sample ? sampleReplyLabel() : t('assistant.didNotAnswer')}</Label>
            {sample ? <Label muted>{t('assistant.didNotAnswer')}</Label> : null}
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
          <Label muted>{sample ? sampleReplyLabel() : t('assistant.answerLabel')}</Label>
          <BodyText>{turn.text}</BodyText>
        </View>
      </Card>
    </View>
  );
};

const NoticeBanner = ({ notice }: { notice: AssistantNotice }): ReactNode => {
  useLanguage();
  switch (notice.kind) {
    case 'none':
      return null;
    case 'not_available':
      return (
        <Banner
          detail={t('assistant.notAvailableDetail')}
          title={t('assistant.notAvailableTitle')}
          tone="info"
        />
      );
    case 'offline':
      return (
        <Banner
          action={{ label: t('assistant.sendAgain'), onPress: notice.onRetry }}
          detail={t('assistant.offlineDetail')}
          title={t('assistant.offlineTitle')}
          tone="offline"
        />
      );
    case 'error':
      return (
        <Banner
          action={{ label: t('common.tryAgain'), onPress: notice.onRetry }}
          detail={t('assistant.errorDetail')}
          title={t('assistant.errorTitle')}
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
  useLanguage();
  const atLimit = allowance.kind === 'at_limit';
  const empty = draft.trim().length === 0;

  return (
    <View style={styles.stack}>
      <Title>{t('assistant.title')}</Title>
      <BodyText muted>{t('assistant.intro')}</BodyText>

      {sample ? (
        <Banner
          detail={t('assistant.sampleDetail')}
          title={t('assistant.sampleTitle')}
          tone="info"
        />
      ) : null}

      <AiAllowanceNotice allowance={allowance} sample={sample} />

      {turns.length === 0 && !sending ? (
        <Card>
          <View style={styles.turn}>
            <Heading>{t('assistant.emptyTitle')}</Heading>
            <BodyText muted>{t('assistant.emptyDetail')}</BodyText>
          </View>
        </Card>
      ) : (
        turns.map((turn) => <Turn key={turn.id} sample={sample} turn={turn} />)
      )}

      {sending ? <Spinner label={t('assistant.waiting')} /> : null}

      <NoticeBanner notice={notice} />

      <TextField
        editable={!sending && !atLimit}
        label={t('assistant.yourQuestion')}
        onChangeText={onChangeDraft}
        value={draft}
      />
      {atLimit ? (
        <Button
          disabled
          label={t('assistant.send')}
          note={t('assistant.unavailableUntilReset')}
          onPress={onSend}
        />
      ) : empty ? (
        <Button
          disabled
          label={t('assistant.send')}
          note={t('assistant.typeFirst')}
          onPress={onSend}
        />
      ) : (
        <Button
          label={t('assistant.send')}
          loading={sending}
          loadingLabel={t('assistant.sending')}
          onPress={() => {
            onSend();
          }}
        />
      )}
    </View>
  );
};
