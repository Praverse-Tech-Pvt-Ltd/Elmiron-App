import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { BodyText as mockBodyText } from '@fieldforce/ui';

/**
 * W2-C C / `BE-W160` — the Product Q&A screen, with its transport injected.
 *
 * The state that matters is the one a pilot company starts in: no approved material, so the server
 * answers "not available". It must read as an honest answer — never as something broken.
 */
jest.mock('../live-connection', () => ({ appLiveConnection: () => ({}) }));
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({ zone: { timeZone: 'Asia/Kolkata', source: 'territory' } }),
}));
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => mockBodyText({ children: `redirect:${href}` }),
}));

import ProductQaRoute, { ProductQa } from '../../app/product-qa';

const askWith = async (answer: { status: number; body: unknown }): Promise<jest.Mock> => {
  const transport = jest.fn(async () => Promise.resolve(answer));
  await render(<ProductQa transport={transport as never} />);
  await fireEvent.changeText(screen.getByLabelText('Your question'), 'What is the dose?');
  await fireEvent.press(screen.getByText('Ask'));
  return transport;
};

describe('app/product-qa.tsx — W2-C C', () => {
  it('NO APPROVED MATERIAL: an honest answer, with where the question goes — not an error', async () => {
    const transport = await askWith({
      status: 200,
      body: {
        kind: 'not_available',
        requestId: 'r',
        message: 'Approved information is not available for this question.',
      },
    });
    expect(await screen.findByText('No approved answer for this yet.')).toBeTruthy();
    expect(
      screen.getByText('Approved information is not available for this question.'),
    ).toBeTruthy();
    expect(screen.getByText(/take the question to your manager or the Medical team/u)).toBeTruthy();
    expect(screen.queryByText(/did not come back|went wrong|error/iu)).toBeNull();
    // The screen sent the rep's question and nothing else.
    expect(transport).toHaveBeenCalledWith({
      feature: 'product_qa',
      question: 'What is the dose?',
    });
  });

  it('an answer shows the document it came from', async () => {
    await askWith({
      status: 200,
      body: {
        kind: 'answered',
        requestId: 'r',
        answer: 'Take 10 mg daily.',
        citations: [
          {
            chunkId: '11111111-1111-4111-8111-111111111111',
            documentTitle: 'Benchmarol SmPC',
            documentVersionId: '22222222-2222-4222-8222-222222222222',
            versionNumber: 3,
            heading: 'Dosage',
            sourceReference: 'SmPC §4.2',
          },
        ],
      },
    });
    expect(await screen.findByText('Take 10 mg daily.')).toBeTruthy();
    expect(screen.getByText('Benchmarol SmPC, version 3 — Dosage (SmPC §4.2)')).toBeTruthy();
    expect(screen.queryByText('No approved answer for this yet.')).toBeNull();
  });

  it('a broken answer IS shown as one, with a retry — the other side of the honest state', async () => {
    await askWith({ status: 500, body: { code: 'gateway_error' } });
    expect(await screen.findByText(/did not come back/u)).toBeTruthy();
    expect(screen.getByText('Ask again')).toBeTruthy();
    expect(screen.queryByText('No approved answer for this yet.')).toBeNull();
  });

  it('with the flag OFF (the default), the route goes to Today', async () => {
    await render(<ProductQaRoute />);
    expect(screen.getByText('redirect:/home')).toBeTruthy();
  });
});
