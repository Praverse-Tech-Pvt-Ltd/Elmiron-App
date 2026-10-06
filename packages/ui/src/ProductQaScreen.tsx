import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Label, Title } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';

/**
 * W2-C C / `BE-W160` — Product Q&A: a question, and an answer only from approved material.
 *
 * **The first real state is "no approved information", and it must read as honest, not broken.**
 * With nothing approved loaded, the server answers every question that way, truthfully. So that
 * state has its own plain card — what it means, and where the question goes meanwhile — and is
 * never drawn as an error. An answer always shows the document it came from.
 */
export type ProductQaView =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'answer';
      readonly text: string;
      readonly sources: readonly { readonly label: string }[];
    }
  | { readonly kind: 'no_approved_information'; readonly text: string }
  | { readonly kind: 'refusal'; readonly text: string }
  | { readonly kind: 'switched_off' }
  | { readonly kind: 'at_limit'; readonly resetLabel: string | null }
  | { readonly kind: 'offline'; readonly onRetry: () => void }
  | { readonly kind: 'error'; readonly onRetry: () => void };

export interface ProductQaScreenProps {
  readonly question: string;
  readonly onChangeQuestion: (value: string) => void;
  readonly onAsk: () => void;
  readonly asking?: boolean;
  readonly view: ProductQaView;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  foot: { gap: tokens.space.sm, paddingTop: tokens.space.sm },
});

const Result = ({ view }: { readonly view: ProductQaView }): ReactNode => {
  switch (view.kind) {
    case 'idle':
      return null;
    case 'answer':
      return (
        <Card>
          <BodyText>{view.text}</BodyText>
          {view.sources.map((source) => (
            <Label key={source.label} muted>{`From: ${source.label}`}</Label>
          ))}
        </Card>
      );
    case 'no_approved_information':
      return (
        <Card>
          <BodyText>No approved answer for this yet.</BodyText>
          <Label muted>{view.text}</Label>
          <Label muted>
            This app answers only from material your company has approved. Until that material is
            loaded, take the question to your manager or the Medical team.
          </Label>
        </Card>
      );
    case 'refusal':
      return (
        <Card>
          <BodyText>{view.text}</BodyText>
        </Card>
      );
    case 'switched_off':
      return (
        <Banner
          detail="Product questions are not switched on for your company yet. Nothing was asked."
          title="Not available yet"
          tone="info"
        />
      );
    case 'at_limit':
      return (
        <Banner
          detail={
            view.resetLabel === null
              ? 'You have used today’s questions.'
              : `You have used today’s questions. They reset at ${view.resetLabel}.`
          }
          title="That is all for today"
          tone="info"
        />
      );
    case 'offline':
      return (
        <Card>
          <BodyText>No signal, so the question was not asked.</BodyText>
          <Button label="Ask again" onPress={view.onRetry} variant="secondary" />
        </Card>
      );
    case 'error':
      return (
        <Card>
          <BodyText>The answer did not come back. Nothing is wrong with your question.</BodyText>
          <Button label="Ask again" onPress={view.onRetry} variant="secondary" />
        </Card>
      );
  }
};

export const ProductQaScreen = ({
  question,
  onChangeQuestion,
  onAsk,
  asking = false,
  view,
}: ProductQaScreenProps): ReactNode => (
  <>
    <View style={styles.head}>
      <Title>Product questions</Title>
      <Label muted>
        Answered only from your company’s approved material, with the source shown.
      </Label>
    </View>

    <TextField
      help="About a product — not about a patient."
      label="Your question"
      onChangeText={onChangeQuestion}
      value={question}
    />

    <View style={styles.foot}>
      {question.trim() === '' ? (
        <Button disabled label="Ask" note="Write your question first." onPress={onAsk} />
      ) : (
        <Button label={asking ? 'Asking…' : 'Ask'} loading={asking} onPress={onAsk} />
      )}
    </View>

    <Result view={view} />
  </>
);
