import { useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { Badge } from './Badge';
import { BodyText, Label, Secondary, Title } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { Select } from './Select';
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
      /** `label` names the source; `detail` is what the source drawer shows when it is opened. */
      readonly sources: readonly { readonly label: string; readonly detail?: readonly string[] }[];
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
  /** The company's products, to narrow the question to one. Absent: no picker is drawn. */
  readonly products?: readonly { readonly id: string; readonly label: string }[];
  readonly productId?: string | null;
  readonly onChangeProduct?: (id: string | null) => void;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  sources: {
    gap: tokens.space.xs,
    marginTop: tokens.space.sm,
    paddingTop: tokens.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.color.hairline,
  },
  sourceToggle: { alignSelf: 'flex-start' },
  foot: { gap: tokens.space.sm, paddingTop: tokens.space.sm },
});

/**
 * An approved answer and the sources it was drawn from. Every answer names its sources (an answer
 * without one is never shown -- `outcome.ts`); the drawer opens each to its document, version,
 * section and reference, so the rep can find the passage in the approved material itself.
 */
const Answer = ({
  text,
  sources,
}: {
  readonly text: string;
  readonly sources: readonly { readonly label: string; readonly detail?: readonly string[] }[];
}): ReactNode => {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      {/*
        UX polish. The answer, then -- below a rule -- where it came from, under a badge that says
        the source is APPROVED material. Each source is named once; the details open on request.
        It used to list every source twice, in one undifferentiated card.
      */}
      <BodyText>{text}</BodyText>
      <View style={styles.sources}>
        <Badge label="Approved sources" tone="success" />
        {sources.map((source) => (
          <Secondary key={source.label}>{source.label}</Secondary>
        ))}
        <View style={styles.sourceToggle}>
          <Button
            label={open ? 'Hide source details' : `Show source details (${String(sources.length)})`}
            onPress={() => {
              setOpen((value) => !value);
            }}
            variant="quiet"
          />
        </View>
      </View>
      {open
        ? sources.map((source) => (
            <Card key={`detail-${source.label}`}>
              <BodyText>{source.label}</BodyText>
              {(source.detail ?? []).map((line) => (
                <Label key={line} muted>
                  {line}
                </Label>
              ))}
            </Card>
          ))
        : null}
    </Card>
  );
};

const Result = ({ view }: { readonly view: ProductQaView }): ReactNode => {
  switch (view.kind) {
    case 'idle':
      return null;
    case 'answer':
      return <Answer sources={view.sources} text={view.text} />;
    case 'no_approved_information':
      return (
        <Card>
          <BodyText>No approved answer for this yet.</BodyText>
          <Secondary>{view.text}</Secondary>
          <Secondary>
            This app answers only from material your company has approved. Until that material is
            loaded, take the question to your manager or the Medical team.
          </Secondary>
        </Card>
      );
    case 'refusal':
      // UX polish (compliance). A refusal was drawn in the answer's own card, with the answer's
      // own type -- a deliberate "not answered" that could be read AS an answer. It is a notice
      // now, titled so that it cannot be.
      return <Banner detail={view.text} title="Not answered" tone="info" />;
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

/** The picker's "no product" choice: the question is searched across all approved material. */
const ANY_PRODUCT = '';

export const ProductQaScreen = ({
  question,
  products,
  productId = null,
  onChangeProduct,
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

    {products === undefined || onChangeProduct === undefined ? null : (
      <Select
        label="Product (optional)"
        onChange={(value) => {
          onChangeProduct(value === ANY_PRODUCT ? null : value);
        }}
        options={[
          { value: ANY_PRODUCT, label: 'Any product' },
          ...products.map((product) => ({ value: product.id, label: product.label })),
        ]}
        value={productId ?? ANY_PRODUCT}
      />
    )}
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
