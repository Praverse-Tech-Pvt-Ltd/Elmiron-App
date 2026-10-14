import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { ProductQaScreen, Screen, t, useLanguage } from '@fieldforce/ui';
import type { ProductQaView } from '@fieldforce/ui';
import { productQaEnabled } from '../src/features';
import { productQaRequestBody } from '../src/product-qa/contract';
import type { ProductQaRequestBody } from '../src/product-qa/contract';
import { createLiveProductQaTransport } from '../src/product-qa/live';
import { productQaOutcome, productQaOutcomeFromThrown } from '../src/product-qa/outcome';
import type { ProductQaOutcome } from '../src/product-qa/outcome';
import { appLiveConnection } from '../src/live-connection';
import { loadProductChoices } from '../src/catalogue/products';
import type { ProductChoice } from '../src/catalogue/products';
import { useBack } from '../src/navigation/back';
import { usePulledStore } from '../src/sync/pulled-store';
import { clockIn, dayMonthIn } from '../src/today/territory-day';

/**
 * W2-C C / `BE-W160` — Product Q&A on the REAL transport, behind `productQaEnabled` (off).
 *
 * The decisions are in `src/product-qa/` and `ProductQaScreen`; this binds them. A transport can be
 * injected for tests; on the device it is the live one, as the signed-in rep.
 */
export const ProductQa = ({
  transport = createLiveProductQaTransport(appLiveConnection()),
}: {
  readonly transport?: (
    body: ProductQaRequestBody,
  ) => ReturnType<ReturnType<typeof createLiveProductQaTransport>>;
}): ReactNode => {
  useLanguage();
  const back = useBack();
  const { zone } = usePulledStore();
  const [question, setQuestion] = useState('');
  // `BE-W175`'s catalogue: the company's active products, kept for offline. The picker is drawn only
  // once a list exists; "Any product" is the default and asks across all approved material.
  const [products, setProducts] = useState<readonly ProductChoice[] | undefined>(undefined);
  const [productId, setProductId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadProductChoices().then((list) => {
      if (live && list.kind !== 'none') setProducts(list.products);
    });
    return () => {
      live = false;
    };
  }, []);
  const [asking, setAsking] = useState(false);
  // The outcome is kept, not its words: the view is written at render, in the current language.
  const [result, setResult] = useState<{
    readonly outcome: ProductQaOutcome;
    readonly retry: () => void;
  } | null>(null);

  const ask = (body: ProductQaRequestBody): void => {
    setAsking(true);
    void transport(body)
      .then(productQaOutcome, productQaOutcomeFromThrown)
      .then((outcome: ProductQaOutcome) => {
        setResult({
          outcome,
          retry: () => {
            ask(body);
          },
        });
      })
      .finally(() => {
        setAsking(false);
      });
  };

  const viewOf = (outcome: ProductQaOutcome, retry: () => void): ProductQaView => {
    switch (outcome.kind) {
      case 'answer':
        return {
          kind: 'answer',
          text: outcome.text,
          sources: outcome.sources.map((source) => ({
            label:
              source.heading === null
                ? t('productQa.sourceLabel', {
                    title: source.documentTitle,
                    version: source.versionNumber,
                    reference: source.sourceReference,
                  })
                : t('productQa.sourceLabelSection', {
                    title: source.documentTitle,
                    version: source.versionNumber,
                    section: source.heading,
                    reference: source.sourceReference,
                  }),
            detail: [
              t('productQa.detailDocument', { title: source.documentTitle }),
              t('productQa.detailVersion', { version: source.versionNumber }),
              ...(source.heading === null
                ? []
                : [t('productQa.detailSection', { section: source.heading })]),
              t('productQa.detailReference', { reference: source.sourceReference }),
            ],
          })),
        };
      case 'no_approved_information':
      case 'refusal':
        return { kind: outcome.kind, text: outcome.text };
      case 'switched_off':
        return { kind: 'switched_off' };
      case 'at_limit':
        return {
          kind: 'at_limit',
          resetLabel:
            outcome.resetsAt === null
              ? null
              : t('ai.resetLabel', {
                  time: clockIn(outcome.resetsAt, zone),
                  date: dayMonthIn(outcome.resetsAt, zone),
                }),
        };
      case 'offline':
      case 'error':
        return { kind: outcome.kind, onRetry: retry };
    }
  };

  const view: ProductQaView =
    result === null ? { kind: 'idle' } : viewOf(result.outcome, result.retry);

  // `FE-W188`. Opened from Me: a pushed screen draws its own way back.
  return (
    <Screen onBack={back} scrollable>
      <ProductQaScreen
        asking={asking}
        onAsk={() => {
          const body = productQaRequestBody(question, productId);
          if (body !== null && !asking) ask(body);
        }}
        onChangeProduct={setProductId}
        onChangeQuestion={setQuestion}
        productId={productId}
        {...(products === undefined ? {} : { products })}
        question={question}
        view={view}
      />
    </Screen>
  );
};

export default function ProductQaRoute(): ReactNode {
  return productQaEnabled ? <ProductQa /> : <Redirect href="/home" />;
}
