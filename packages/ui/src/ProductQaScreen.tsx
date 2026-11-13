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
import { t, useLanguage } from './i18n';

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
  head: { gap: tokens.space.xxs },
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
  useLanguage();
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
        <Badge label={t('productQa.approvedSources')} tone="success" />
        {sources.map((source) => (
          <Secondary key={source.label}>{source.label}</Secondary>
        ))}
        <View style={styles.sourceToggle}>
          <Button
            label={
              open ? t('productQa.hideDetails') : t('productQa.showDetails', { n: sources.length })
            }
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
  useLanguage();
  switch (view.kind) {
    case 'idle':
      return null;
    case 'answer':
      return <Answer sources={view.sources} text={view.text} />;
    case 'no_approved_information':
      return (
        <Card>
          <BodyText>{t('productQa.noApprovedTitle')}</BodyText>
          <Secondary>{view.text}</Secondary>
          <Secondary>{t('productQa.noApprovedDetail')}</Secondary>
        </Card>
      );
    case 'refusal':
      // UX polish (compliance). A refusal was drawn in the answer's own card, with the answer's
      // own type -- a deliberate "not answered" that could be read AS an answer. It is a notice
      // now, titled so that it cannot be.
      return <Banner detail={view.text} title={t('productQa.notAnswered')} tone="info" />;
    case 'switched_off':
      return (
        <Banner
          detail={t('productQa.switchedOffDetail')}
          title={t('productQa.switchedOffTitle')}
          tone="info"
        />
      );
    case 'at_limit':
      return (
        <Banner
          detail={
            view.resetLabel === null
              ? t('productQa.usedToday')
              : t('productQa.usedTodayResets', { time: view.resetLabel })
          }
          title={t('productQa.limitTitle')}
          tone="info"
        />
      );
    case 'offline':
      return (
        <Card>
          <BodyText>{t('productQa.offline')}</BodyText>
          <Button label={t('productQa.askAgain')} onPress={view.onRetry} variant="secondary" />
        </Card>
      );
    case 'error':
      return (
        <Card>
          <BodyText>{t('productQa.error')}</BodyText>
          <Button label={t('productQa.askAgain')} onPress={view.onRetry} variant="secondary" />
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
}: ProductQaScreenProps): ReactNode => {
  useLanguage();
  return (
    <>
      <View style={styles.head}>
        <Title>{t('productQa.title')}</Title>
        {/* `FE-W178`. The line under a screen title is `Secondary`, as on the call report. */}
        <Secondary>{t('productQa.intro')}</Secondary>
      </View>

      {products === undefined || onChangeProduct === undefined ? null : (
        <Select
          label={t('productQa.product')}
          onChange={(value) => {
            onChangeProduct(value === ANY_PRODUCT ? null : value);
          }}
          options={[
            { value: ANY_PRODUCT, label: t('productQa.anyProduct') },
            ...products.map((product) => ({ value: product.id, label: product.label })),
          ]}
          value={productId ?? ANY_PRODUCT}
        />
      )}
      <TextField
        help={t('productQa.help')}
        label={t('productQa.yourQuestion')}
        onChangeText={onChangeQuestion}
        value={question}
      />

      <View style={styles.foot}>
        {question.trim() === '' ? (
          <Button
            disabled
            label={t('productQa.ask')}
            note={t('productQa.writeFirst')}
            onPress={onAsk}
          />
        ) : (
          <Button
            label={asking ? t('productQa.asking') : t('productQa.ask')}
            loading={asking}
            onPress={onAsk}
          />
        )}
      </View>

      <Result view={view} />
    </>
  );
};
