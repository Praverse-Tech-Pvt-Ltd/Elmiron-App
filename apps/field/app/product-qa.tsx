import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { ProductQaScreen, Screen } from '@fieldforce/ui';
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
  const [view, setView] = useState<ProductQaView>({ kind: 'idle' });

  const ask = (body: ProductQaRequestBody): void => {
    setAsking(true);
    void transport(body)
      .then(productQaOutcome, productQaOutcomeFromThrown)
      .then((outcome: ProductQaOutcome) => {
        setView(
          viewOf(outcome, () => {
            ask(body);
          }),
        );
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
            label: `${source.documentTitle}, version ${String(source.versionNumber)}${
              source.heading === null ? '' : ` — ${source.heading}`
            } (${source.sourceReference})`,
            detail: [
              `Document: ${source.documentTitle}`,
              `Approved version ${String(source.versionNumber)}`,
              ...(source.heading === null ? [] : [`Section: ${source.heading}`]),
              `Reference: ${source.sourceReference}`,
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
              : `${clockIn(outcome.resetsAt, zone)} on ${dayMonthIn(outcome.resetsAt, zone)}`,
        };
      case 'offline':
      case 'error':
        return { kind: outcome.kind, onRetry: retry };
    }
  };

  return (
    <Screen scrollable>
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
