import { postGateway } from '../live-rest';
import type { LiveConnection } from '../live-rest';
import type { ChatRequestBody, GatewayResponse } from './contract';

/**
 * W1-Z B — the REAL assistant transport: the same signature as `assistantTransport` in `transport.ts`,
 * so the screen does not change. Built once FE-CR-7 landed on `main`; NOT what `transport.ts` exports
 * yet — the screen still says "sample data", and switching is the access-day step (W1-Z B5).
 *
 * It sends exactly the screen's body — the feature and the rep's own text — to the `ai-gateway`, as the
 * signed-in rep, and returns the status and body unchanged for `outcome.ts` to interpret.
 */
export const createLiveAssistantTransport =
  (connection: LiveConnection) =>
  (body: ChatRequestBody): Promise<GatewayResponse> =>
    postGateway(connection, { feature: body.feature, message: body.message });
