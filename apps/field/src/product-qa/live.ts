import { postGateway } from '../live-rest';
import type { LiveConnection } from '../live-rest';
import type { GatewayResponse } from '../assistant/contract';
import type { ProductQaRequestBody } from './contract';

/**
 * W2-C C / `BE-W160` — the REAL Product Q&A transport: the rep's question to `ai-gateway`, as the
 * signed-in rep, and the status and body back unchanged for `outcome.ts`. No sample behind it: the
 * screen is off by a flag instead, because the honest first answer ("approved information not
 * available") needs no sample to be shown — it is what the real server says today.
 */
export const createLiveProductQaTransport =
  (connection: LiveConnection) =>
  (body: ProductQaRequestBody): Promise<GatewayResponse> =>
    postGateway(
      connection,
      body.productId === undefined
        ? { feature: body.feature, question: body.question }
        : { feature: body.feature, question: body.question, productId: body.productId },
    );
