import { sampleTransport } from './sample';
import type { ChatRequestBody, GatewayResponse } from './contract';

/**
 * FE-D15 — where a chat request goes.
 *
 * **Today, only to the sample fixture.** Nothing here reaches the network. When FE-CR-7 lands the
 * chat contract on `main`, this becomes the POST to the `ai-gateway` Edge Function, and the route
 * and the screen do not change: both already speak `GatewayResponse`.
 */
export const assistantTransport = (body: ChatRequestBody): Promise<GatewayResponse> =>
  sampleTransport(body);
