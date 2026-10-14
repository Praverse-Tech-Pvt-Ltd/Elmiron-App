import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { AiAllowanceNotice } from './AiAllowanceNotice';
import type { AiAllowanceState } from './AiAllowanceNotice';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { Badge } from './Badge';
import { BodyText, Heading, Label, Title } from './Text';
import { TextField } from './TextField';
import { samplePracticeNote } from './PracticeHomeScreen';
import { t, useLanguage } from './i18n';

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
  | { readonly kind: 'error'; readonly onRetry: () => void }
  /**
   * UX polish (a real defect): ending the session or asking for feedback failed. It used to reuse
   * `offline`/`error`, whose words are about a TURN ("Your turn was not sent") and whose retry
   * resends the unsent turn -- of which there was none, so the button did nothing and the rep was
   * stuck at the end of a practice. This one names the action and retries that action.
   */
  | {
      readonly kind: 'action_failed';
      readonly action: 'end' | 'feedback';
      readonly offline: boolean;
      readonly onRetry: () => void;
    };

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
  useLanguage();
  switch (notice.kind) {
    case 'none':
      return null;
    case 'refused':
      return (
        <Card>
          <View style={styles.turn}>
            <Label muted>{t('practice.refusedLabel')}</Label>
            <BodyText>{notice.message}</BodyText>
          </View>
        </Card>
      );
    case 'not_available':
      return (
        <Banner
          detail={t('practice.notAvailableDetail')}
          title={t('practice.notAvailableTitle')}
          tone="info"
        />
      );
    case 'offline':
      return (
        <Banner
          action={{ label: t('practice.sendAgain'), onPress: notice.onRetry }}
          detail={t('practice.offlineDetail')}
          title={t('practice.offlineTitle')}
          tone="offline"
        />
      );
    case 'error':
      return (
        <Banner
          action={{ label: t('common.tryAgain'), onPress: notice.onRetry }}
          detail={t('practice.errorDetail')}
          title={t('practice.errorTitle')}
          tone="critical"
        />
      );
    case 'action_failed':
      return (
        <Banner
          action={{ label: t('common.tryAgain'), onPress: notice.onRetry }}
          detail={
            notice.offline
              ? t('practice.actionOffline')
              : notice.action === 'end'
                ? t('practice.endFailedDetail')
                : t('practice.feedbackFailedDetail')
          }
          title={
            notice.action === 'end'
              ? t('practice.endFailedTitle')
              : t('practice.feedbackFailedTitle')
          }
          tone={notice.offline ? 'offline' : 'critical'}
        />
      );
  }
};

/**
 * Standing, beside the box the rep types into: this is a rehearsal with an AI, so nothing real
 * belongs in it. Shown on every session, sample or live -- not only when something is wrong.
 */
export const practiceOnlyNote = (): string => t('practice.onlyNote');

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
  useLanguage();
  if (failure !== null) {
    return <Banner detail={failure.detail} title={failure.title} tone="critical" />;
  }
  if (loading) return <Spinner label={t('practice.opening')} />;

  const atLimit = allowance.kind === 'at_limit';
  const empty = draft.trim().length === 0;

  return (
    <View style={styles.stack}>
      {/*
        UX polish. Framed as what it is before anything else: a simulation, with an AI. The
        persona's name was the only title, which read like a real doctor's.
      */}
      <Title>{t('practice.simulationTitle')}</Title>
      <Badge label={t('practice.aiBadge')} tone="info" />
      <Heading>{personaName}</Heading>
      <Label muted>{personaLine}</Label>
      {sample ? (
        <Banner detail={samplePracticeNote()} title={t('practice.sampleTitle')} tone="info" />
      ) : null}

      <Card>
        <View style={styles.turn}>
          <Label muted>{t('practice.yourAim')}</Label>
          <BodyText>{objective}</BodyText>
          <Label muted>{t('practice.pushBack')}</Label>
          <BodyText>{objection}</BodyText>
        </View>
      </Card>

      <AiAllowanceNotice allowance={allowance} sample={sample} />

      {turns.map((turn) => (
        <View key={turn.turnIndex} style={turn.role === 'rep' ? styles.rep : null}>
          <Card tone={turn.role === 'doctor' ? 'default' : 'quiet'}>
            <View style={styles.turn}>
              <Label muted>
                {turn.role === 'rep'
                  ? t('practice.youTurn', { n: turn.turnIndex })
                  : t('practice.doctorTurn', { name: personaName, n: turn.turnIndex })}
              </Label>
              <BodyText>{turn.text}</BodyText>
            </View>
          </Card>
        </View>
      ))}

      {sending ? <Spinner label={t('practice.answering')} /> : null}
      <NoticeBanner notice={notice} />

      {phase === 'open' ? (
        <>
          <TextField
            editable={!sending && !atLimit}
            help={practiceOnlyNote()}
            label={t('practice.whatYouSay')}
            onChangeText={onChangeDraft}
            value={draft}
          />
          {atLimit ? (
            <Button
              disabled
              label={t('practice.send')}
              note={t('practice.unavailableUntilReset')}
              onPress={onSend}
            />
          ) : empty ? (
            <Button
              disabled
              label={t('practice.send')}
              note={t('practice.sayFirst')}
              onPress={onSend}
            />
          ) : (
            <Button
              label={t('practice.send')}
              loading={sending}
              loadingLabel={t('practice.sending')}
              onPress={onSend}
            />
          )}
          <Button
            label={t('practice.end')}
            loading={busy}
            loadingLabel={t('practice.ending')}
            onPress={onEnd}
            variant="secondary"
          />
        </>
      ) : (
        <Button
          label={t('practice.getFeedback')}
          loading={busy}
          loadingLabel={t('practice.gettingFeedback')}
          onPress={onGetFeedback}
        />
      )}
    </View>
  );
};
