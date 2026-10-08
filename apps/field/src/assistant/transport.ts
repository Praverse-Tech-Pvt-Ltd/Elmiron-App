import { appLiveConnection } from '../live-connection';
import { createLiveAssistantTransport } from './live';
import type { ChatRequestBody, GatewayResponse } from './contract';

/**
 * FE-D15 — where a chat request goes.
 *
 * **Today, only to the sample fixture.** Nothing here reaches the network. When FE-CR-7 lands the
 * chat contract on `main`, this becomes the POST to the `ai-gateway` Edge Function, and the route
 * and the screen do not change: both already speak `GatewayResponse`.
 */
// W2-G A: the REAL transport, as the signed-in rep — switched now rather than on the day model
// access lands (W1-Z B5), behind `assistantEnabled`, which stays off while the only model is the stub.
// Proved end to end in `services/api/tests/mr-chat.spec.ts` (W1-Z B3) and `day-one-states.spec.ts`.
export const assistantTransport = (body: ChatRequestBody): Promise<GatewayResponse> =>
  createLiveAssistantTransport(appLiveConnection())(body);
