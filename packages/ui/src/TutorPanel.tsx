import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Button } from './Button';
import { Badge } from './Badge';
import { Banner } from './Banner';
import { Card } from './Card';
import { BodyText, Label, Secondary } from './Text';
import { TextField } from './TextField';
import { useT } from './i18n';

/**
 * The lesson tutor, under a lesson: ask about THIS lesson, answered only from its own text.
 *
 * Every state is distinct, and none pretends: an answer the gateway would not ground in the lesson
 * reads as "not covered", a patient question as a refusal, and no model (or the stub) as
 * "not available" -- never as an answer.
 *
 * `FE-W183`. The panel's own words are on the catalogue (`tutor.*`); the explanation and the
 * gateway's "not covered" / refusal sentences are the server's, shown as they came.
 */
export type TutorView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'explained'; readonly text: string }
  | { readonly kind: 'not_in_lesson'; readonly text: string }
  | { readonly kind: 'refusal'; readonly text: string }
  | { readonly kind: 'switched_off' }
  | { readonly kind: 'at_limit'; readonly resetLabel: string | null }
  | { readonly kind: 'offline'; readonly onRetry: () => void }
  | { readonly kind: 'error'; readonly onRetry: () => void };

export interface TutorPanelProps {
  readonly question: string;
  readonly onChangeQuestion: (value: string) => void;
  readonly onAsk: () => void;
  readonly asking?: boolean;
  readonly view: TutorView;
}

const styles = StyleSheet.create({
  panel: { gap: tokens.space.sm, paddingTop: tokens.space.md },
});

const Result = ({ view }: { readonly view: TutorView }): ReactNode => {
  const { t } = useT();
  switch (view.kind) {
    case 'idle':
      return null;
    case 'explained':
      return (
        <Card>
          {/* UX polish: said up front that an AI explained this, and from what. */}
          <Badge label={t('tutor.badge')} tone="info" />
          <BodyText>{view.text}</BodyText>
          <Secondary>{t('tutor.explainedFrom')}</Secondary>
        </Card>
      );
    case 'not_in_lesson':
      // UX polish: a deliberate "not answered", never drawn like an explanation.
      return <Banner detail={view.text} title={t('tutor.notCoveredTitle')} tone="info" />;
    case 'refusal':
      return <Banner detail={view.text} title={t('tutor.notAnsweredTitle')} tone="info" />;
    case 'switched_off':
      return (
        <Card>
          <BodyText>{t('tutor.notAvailable')}</BodyText>
          <Secondary>{t('tutor.notAvailableDetail')}</Secondary>
        </Card>
      );
    case 'at_limit':
      return (
        <Card>
          <BodyText>{t('tutor.usedToday')}</BodyText>
          {view.resetLabel === null ? null : (
            <Secondary>{t('tutor.moreFrom', { when: view.resetLabel })}</Secondary>
          )}
        </Card>
      );
    case 'offline':
      return (
        <Card>
          <BodyText>{t('tutor.offline')}</BodyText>
          <Button label={t('common.tryAgain')} onPress={view.onRetry} variant="secondary" />
        </Card>
      );
    case 'error':
      return (
        <Card>
          <BodyText>{t('tutor.error')}</BodyText>
          <Button label={t('common.tryAgain')} onPress={view.onRetry} variant="secondary" />
        </Card>
      );
  }
};

export const TutorPanel = ({
  question,
  onChangeQuestion,
  onAsk,
  asking = false,
  view,
}: TutorPanelProps): ReactNode => {
  const { t } = useT();
  return (
    <View style={styles.panel}>
      {/* `FE-W178`. A section header under the lesson: muted 13.5, as the designs draw them. */}
      <Label muted>{t('tutor.heading')}</Label>
      <TextField
        help={t('tutor.help')}
        label={t('tutor.question')}
        onChangeText={onChangeQuestion}
        value={question}
      />
      {question.trim() === '' ? (
        <Button disabled label={t('tutor.ask')} note={t('tutor.writeFirst')} onPress={onAsk} />
      ) : (
        <Button
          label={asking ? t('tutor.asking') : t('tutor.ask')}
          loading={asking}
          onPress={onAsk}
        />
      )}
      <Result view={view} />
    </View>
  );
};
