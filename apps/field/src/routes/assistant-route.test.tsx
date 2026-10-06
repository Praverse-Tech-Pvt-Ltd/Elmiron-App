import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type * as ReactModule from 'react';
import type * as UiModule from '@fieldforce/ui';
import type { ChatRequestBody, GatewayResponse } from '../assistant/contract';

/**
 * FE-D15 — app/assistant.tsx.
 *
 * The transport is the sample fixture today (no real gateway until FE-CR-7 lands). It is mocked
 * here so each case can name the exact reply, and so the REQUEST the route sends can be
 * inspected. The pulled store deliberately holds a doctor, a visit and a clinic, so the payload
 * test proves none of them rides along with what the rep typed.
 */

let mockAssistantEnabled = true;
jest.mock('../features', () => ({
  get assistantSampleEnabled() {
    return mockAssistantEnabled;
  },
  coachingEnabled: false,
}));
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const React = jest.requireActual<typeof ReactModule>('react');
    const ui = jest.requireActual<typeof UiModule>('@fieldforce/ui');
    return React.createElement(ui.BodyText, null, `redirect:${href}`);
  },
  useRouter: () => ({ push: jest.fn() }),
}));

const mockTransport = jest.fn<(body: ChatRequestBody) => Promise<GatewayResponse>>();
jest.mock('../assistant/transport', () => ({
  assistantTransport: (body: ChatRequestBody) => mockTransport(body),
}));

const DOCTOR_ID = '22222222-2222-4222-8222-2222222222bb';
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    store: {
      doctor: new Map([
        [
          '22222222-2222-4222-8222-2222222222bb',
          { id: '22222222-2222-4222-8222-2222222222bb', fullName: 'Dr Asha Deshpande' },
        ],
      ]),
    },
  }),
}));

import Assistant from '../../app/assistant';

const answered = (answer: string, extra: Record<string, unknown> = {}): GatewayResponse => ({
  status: 200,
  body: { kind: 'answered', requestId: 'r1', answer, ...extra },
});

const ask = async (question: string): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText('Your question'), question);
  await fireEvent.press(screen.getByText('Send'));
};

beforeEach(() => {
  mockAssistantEnabled = true;
  mockTransport.mockReset();
});

describe('FE-D15 — the flag', () => {
  it('with the flag off, the route is not reachable: a deep link goes to Today', async () => {
    mockAssistantEnabled = false;
    await render(<Assistant />);

    expect(screen.getByText('redirect:/home')).toBeTruthy();
    expect(screen.queryByText('Ask the assistant')).toBeNull();
  });

  it('with the flag on, the screen opens empty and labelled as sample data', async () => {
    await render(<Assistant />);

    expect(screen.getByText('Ask the assistant')).toBeTruthy();
    expect(screen.getByText('No questions yet')).toBeTruthy();
    expect(screen.getByText('Sample data')).toBeTruthy();
  });
});

describe('FE-D15 — only what the rep typed is sent', () => {
  it('the request is exactly { feature, message }, with no doctor, patient or visit data', async () => {
    mockTransport.mockResolvedValue(answered('Sample answer.'));
    await render(<Assistant />);

    await ask('  How do I end my day?  ');
    await screen.findByText('Sample answer.');

    expect(mockTransport).toHaveBeenCalledTimes(1);
    const sent = mockTransport.mock.calls[0]?.[0];
    expect(sent).toEqual({ feature: 'mr_chat', message: 'How do I end my day?' });
    const wire = JSON.stringify(sent);
    expect(wire).not.toMatch(/Asha|Deshpande/u);
    expect(wire).not.toContain(DOCTOR_ID);
    expect(wire).not.toMatch(/history|doctor|patient|visit|clinic/iu);
  });
});

describe('FE-D15 — the states, through the route', () => {
  it('sending, then a sample answer labelled as sample', async () => {
    let settle: (value: GatewayResponse) => void = () => undefined;
    mockTransport.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    await render(<Assistant />);

    await ask('How do I end my day?');
    expect(screen.getByText('Waiting for the assistant')).toBeTruthy();

    settle(answered('Sample answer. Nothing real.'));
    expect(await screen.findByText('Sample answer. Nothing real.')).toBeTruthy();
    expect(screen.getByText('Sample reply, not from the assistant')).toBeTruthy();
  });

  it('a refusal is shown as a refusal', async () => {
    mockTransport.mockResolvedValue({
      status: 200,
      body: { kind: 'out_of_scope', requestId: 'r1', message: 'Use Product Q&A.' },
    });
    await render(<Assistant />);

    await ask('What is the dose?');

    expect(await screen.findByTestId('assistant-refusal')).toBeTruthy();
    expect(screen.queryByTestId('assistant-answer')).toBeNull();
  });

  it('the placeholder (no model connected) is NEVER shown as an answer', async () => {
    mockTransport.mockResolvedValue({ status: 503, body: { code: 'no_provider' } });
    await render(<Assistant />);

    await ask('unavailable');

    expect(await screen.findByText('The assistant is not available yet')).toBeTruthy();
    expect(screen.queryByTestId('assistant-answer')).toBeNull();
  });

  it('a stub-marked reply is NEVER shown as an answer either', async () => {
    mockTransport.mockResolvedValue(
      answered('[PRACTICE STUB - no AI provider is configured; decision #5 is open]'),
    );
    await render(<Assistant />);

    await ask('How do I add a doctor?');

    expect(await screen.findByText('The assistant is not available yet')).toBeTruthy();
    expect(screen.queryByTestId('assistant-answer')).toBeNull();
    expect(screen.queryByText(/PRACTICE STUB/u)).toBeNull();
  });

  it("the warning shows the server's figures, and the reset in the territory zone", async () => {
    mockTransport.mockResolvedValue(
      answered('Sample answer.', {
        allowance: {
          warning: true,
          requestsUsedToday: 83,
          dailyLimit: 104,
          resetsAt: '2026-10-01T18:30:00.000Z',
        },
      }),
    );
    await render(<Assistant />);

    await ask('warn');

    expect(
      await screen.findByText("You have used 83 of today's 104 assistant requests."),
    ).toBeTruthy();
    expect(screen.getByText('The allowance resets at 00:00 on 2 Oct.')).toBeTruthy();
  });

  it('at the limit, it says so and Send stops working', async () => {
    mockTransport.mockResolvedValue({
      status: 429,
      // The gateway's real 429 (`BE-W161`): the reset instant is inside `allowance`.
      body: {
        code: '45012',
        message: 'ai daily limit reached',
        allowance: {
          warning: true,
          requestsUsedToday: 104,
          dailyLimit: 104,
          resetsAt: '2026-10-01T18:30:00.000Z',
        },
      },
    });
    await render(<Assistant />);

    await ask('limit');
    expect(
      await screen.findByText(
        "You have reached today's limit. The assistant is unavailable until it resets.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('It resets at 00:00 on 2 Oct.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Send'));
    expect(mockTransport).toHaveBeenCalledTimes(1);
  });

  it('offline: retry sends the same question again, once, without repeating it on screen', async () => {
    mockTransport.mockRejectedValueOnce(new TypeError('Network request failed'));
    mockTransport.mockResolvedValueOnce(answered('Sample answer.'));
    await render(<Assistant />);

    await ask('How do I end my day?');
    expect(await screen.findByText('You are offline')).toBeTruthy();

    await fireEvent.press(screen.getByText('Send again'));

    expect(await screen.findByText('Sample answer.')).toBeTruthy();
    expect(mockTransport).toHaveBeenCalledTimes(2);
    expect(mockTransport.mock.calls[1]?.[0]).toEqual({
      feature: 'mr_chat',
      message: 'How do I end my day?',
    });
    expect(screen.getAllByText('How do I end my day?')).toHaveLength(1);
    expect(screen.queryByText('You are offline')).toBeNull();
  });

  it('error: a retry is offered', async () => {
    mockTransport.mockResolvedValue({ status: 500, body: { code: 'gateway_error' } });
    await render(<Assistant />);

    await ask('error');

    expect(await screen.findByText('The assistant could not answer')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
