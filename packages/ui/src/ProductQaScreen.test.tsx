import { describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProductQaScreen } from './ProductQaScreen';
import type { ProductQaScreenProps } from './ProductQaScreen';

const noop = (): void => undefined;

const base: ProductQaScreenProps = {
  question: '',
  onChangeQuestion: noop,
  onAsk: noop,
  view: { kind: 'idle' },
};

const answer: ProductQaScreenProps['view'] = {
  kind: 'answer',
  text: 'Take with food.',
  sources: [
    {
      label: 'Activex leaflet, version 2 — Dosing (p. 4)',
      detail: [
        'Document: Activex leaflet',
        'Approved version 2',
        'Section: Dosing',
        'Reference: p. 4',
      ],
    },
  ],
};

describe('ProductQaScreen — product picker and source drawer', () => {
  it('no catalogue: no picker is drawn', async () => {
    await render(<ProductQaScreen {...base} />);
    expect(screen.queryByText('Product (optional)')).toBeNull();
  });

  it('with a catalogue: a picker with "Any product" as the default', async () => {
    await render(
      <ProductQaScreen
        {...base}
        onChangeProduct={noop}
        productId={null}
        products={[{ id: 'p1', label: 'Activex' }]}
      />,
    );
    expect(screen.getByText('Product (optional)')).toBeTruthy();
    expect(screen.getByText('Any product')).toBeTruthy();
  });

  it('an answer names its sources, and the drawer opens each to its document, version, section and reference', async () => {
    await render(<ProductQaScreen {...base} view={answer} />);
    expect(screen.getByText('From: Activex leaflet, version 2 — Dosing (p. 4)')).toBeTruthy();
    expect(screen.queryByText('Reference: p. 4')).toBeNull();

    await fireEvent.press(screen.getByText('Show sources (1)'));
    expect(screen.getByText('Document: Activex leaflet')).toBeTruthy();
    expect(screen.getByText('Reference: p. 4')).toBeTruthy();

    await fireEvent.press(screen.getByText('Hide sources'));
    expect(screen.queryByText('Reference: p. 4')).toBeNull();
  });

  it('a refusal or no approved information shows no drawer', async () => {
    await render(
      <ProductQaScreen {...base} view={{ kind: 'no_approved_information', text: 'x' }} />,
    );
    expect(screen.queryByText(/Show sources/u)).toBeNull();
  });
});
