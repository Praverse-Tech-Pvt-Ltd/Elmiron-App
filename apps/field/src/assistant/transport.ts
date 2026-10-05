import { sampleTransport } from './sample';
import type { ChatRequestBody, GatewayResponse } from './contract';

/**
 * FE-D15 — where a chat request goes.
 *
 * **Today, only to the sample fixture.** Nothing here reaches the network. When FE-CR-7 lands the
 * chat contract on `main`, this becomes the POST to the `ai-gateway` Edge Function, and the route
 * and the screen do not change: both already speak `GatewayResponse`.
 */
// W1-Z B4: still the sample, on purpose. The real transport is `createLiveAssistantTransport` in
// `./live.ts`, proved end to end (`services/api/tests/mr-chat.spec.ts`, W1-Z B3); switching this line,
// with the screen's "sample data" wording, is a step of the day model access lands (W1-Z B5).
export const assistantTransport = (body: ChatRequestBody): Promise<GatewayResponse> =>
  sampleTransport(body);
