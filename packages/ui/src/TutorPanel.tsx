import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Button } from './Button';
import { Badge } from './Badge';
import { Banner } from './Banner';
import { Card } from './Card';
import { BodyText, Heading, Label } from './Text';
import { TextField } from './TextField';

/**
 * The lesson tutor, under a lesson: ask about THIS lesson, answered only from its own text.
 *
 * Every state is distinct, and none pretends: an answer the gateway would not ground in the lesson
 * reads as "not covered", a patient question as a refusal, and no model (or the stub) as
 * "not available" -- never as an answer.
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
  switch (view.kind) {
    case 'idle':
      return null;
    case 'explained':
      return (
        <Card>
          {/* UX polish: said up front that an AI explained this, and from what. */}
          <Badge label="AI tutor · from this lesson" tone="info" />
          <BodyText>{view.text}</BodyText>
          <Label muted>Explained from this lesson only.</Label>
        </Card>
      );
    case 'not_in_lesson':
      // UX polish: a deliberate "not answered", never drawn like an explanation.
      return <Banner detail={view.text} title="Not covered in this lesson" tone="info" />;
    case 'refusal':
      return <Banner detail={view.text} title="Not answered" tone="info" />;
    case 'switched_off':
      return (
        <Card>
          <BodyText>The tutor is not available yet.</BodyText>
          <Label muted>It needs an AI model connected for your company.</Label>
        </Card>
      );
    case 'at_limit':
      return (
        <Card>
          <BodyText>You have used today’s questions.</BodyText>
          {view.resetLabel === null ? null : <Label muted>{`More from ${view.resetLabel}.`}</Label>}
        </Card>
      );
    case 'offline':
      return (
        <Card>
          <BodyText>No signal — the question was not sent.</BodyText>
          <Button label="Try again" onPress={view.onRetry} variant="secondary" />
        </Card>
      );
    case 'error':
      return (
        <Card>
          <BodyText>The tutor could not answer just now.</BodyText>
          <Button label="Try again" onPress={view.onRetry} variant="secondary" />
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
}: TutorPanelProps): ReactNode => (
  <View style={styles.panel}>
    <Heading>Ask about this lesson</Heading>
    <TextField
      help="About this lesson — not about a patient."
      label="Your question"
      onChangeText={onChangeQuestion}
      value={question}
    />
    {question.trim() === '' ? (
      <Button disabled label="Ask the tutor" note="Write your question first." onPress={onAsk} />
    ) : (
      <Button label={asking ? 'Asking…' : 'Ask the tutor'} loading={asking} onPress={onAsk} />
    )}
    <Result view={view} />
  </View>
);
