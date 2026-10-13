import {
  PUSH_RPC,
  PushTokenRegistrationSchema,
  PushTokenUnregistrationSchema,
} from '@fieldforce/core';
import { callRpc } from '../live-rest';
import type { LiveConnection } from '../live-rest';
import type { PushServer } from './registration';

/**
 * `FE-W86` / `BE-W195` — the two push RPCs, as the signed-in person. Every answer is parsed with the
 * contract's schema, so a server that answers a different shape fails loudly here.
 */
export const createPushServer = (c: LiveConnection): PushServer => ({
  register: async (token) => {
    PushTokenRegistrationSchema.parse(await callRpc(c, PUSH_RPC.registerToken, { p_token: token }));
  },
  unregister: async (token) => {
    PushTokenUnregistrationSchema.parse(
      await callRpc(c, PUSH_RPC.unregisterToken, { p_token: token }),
    );
  },
});
