/**
 * W1-V A — the ONE place the AWS SDK is used: the real `Converse` for `bedrock-provider.ts`.
 *
 * Kept apart so everything else in the adapter is testable without the SDK or a model call.
 * `@aws-sdk/client-bedrock-runtime` is pinned exactly in `../deno.json` (approved W1-U2).
 *
 * The credential is read from the function's environment — Edge Function secrets in production,
 * the git-ignored `functions/.env` locally — and never logged, returned, or put in an error.
 */
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { BEDROCK_REGION, BedrockConfigurationError } from './bedrock-provider.ts';
import type { Converse } from './bedrock-provider.ts';

export const bedrockConverse = (env: {
  readonly accessKeyId: string | undefined;
  readonly secretAccessKey: string | undefined;
}): Converse => {
  if (!env.accessKeyId || !env.secretAccessKey) {
    throw new BedrockConfigurationError('no AWS credential is configured for the Bedrock adapter');
  }
  const client = new BedrockRuntimeClient({
    region: BEDROCK_REGION,
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
  });
  return (input, { abortSignal }) =>
    client.send(new ConverseCommand(input as ConstructorParameters<typeof ConverseCommand>[0]), {
      abortSignal,
    });
};
