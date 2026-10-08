import { describe, expect, it, vi } from 'vitest';

/**
 * W2-G A — the switch itself. The route tests replace `assistantTransport` and `practiceBackend` with
 * fakes, so without this file the app's exported transports could go back to the sample and nothing
 * would notice. Here the exported ones are called, with only the CONNECTION replaced: they must post
 * the rep's request to the real gateway path, with the rep's token.
 */
const calls: { url: string; init: RequestInit }[] = [];
/** The JSON body a call sent — `live-rest` always sends a string. */
const bodyOf = (i: number): unknown => JSON.parse(calls[i]?.init.body as string);
const fakeFetch = (url: string, init: RequestInit): Promise<Response> => {
  calls.push({ url, init });
  return Promise.resolve(
    new Response(JSON.stringify({ kind: 'answered', requestId: 'r', answer: 'x' })),
  );
};
vi.mock('../live-connection', () => ({
  appLiveConnection: () => ({
    baseUrl: 'https://project.example',
    apiKey: 'publishable',
    accessToken: () => Promise.resolve('rep-token'),
    fetch: fakeFetch,
  }),
}));

describe('W2-G A — the app’s transports are the LIVE ones', () => {
  it('the assistant posts { feature, message } to ai-gateway, as the rep', async () => {
    calls.length = 0;
    const { assistantTransport } = await import('./transport');
    const response = await assistantTransport({
      feature: 'mr_chat',
      message: 'How do I end my day?',
    });
    expect(response.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(['https://project.example/functions/v1/ai-gateway']);
    expect(bodyOf(0)).toEqual({
      feature: 'mr_chat',
      message: 'How do I end my day?',
    });
    expect((calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer rep-token',
    );
  });

  it('practice posts a turn to ai-gateway as `ai_doctor`, as the rep', async () => {
    calls.length = 0;
    const { practiceBackend } = await import('../practice/transport');
    await practiceBackend.turn({
      feature: 'ai_doctor',
      sessionId: '11111111-1111-4111-8111-111111111111',
      repText: 'Good morning.',
    } as never);
    expect(calls.map((c) => c.url)).toEqual(['https://project.example/functions/v1/ai-gateway']);
    expect(bodyOf(0)).toMatchObject({
      feature: 'ai_doctor',
      repText: 'Good morning.',
    });
  });
});
