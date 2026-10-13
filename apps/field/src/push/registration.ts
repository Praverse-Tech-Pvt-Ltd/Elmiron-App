/**
 * `FE-W86` — registering this phone for push notifications, as the signed-in person, and taking it
 * back on sign-out. Pure: the platform, the server and the phone's memory are passed in, so every
 * branch runs under vitest; `push-provider.tsx` supplies the real ones.
 *
 * **Permission is never asked for here.** Android 13's notification permission is asked on the
 * first-run screen that names what the app will send (`app/onboarding/notifications.tsx`) -- the one
 * place the rep can see what they are agreeing to. Registration only READS the answer: granted, the
 * token is registered; anything else, nothing happens, and it is read again the next time the app
 * comes on screen (so a rep who allows notifications later in Settings starts receiving them).
 *
 * **One phone, one person.** The token registered is remembered with WHO registered it; a different
 * person signing in registers again (the server retires the previous holder's row, `replaced`), and
 * signing out retires this person's row before the session ends (`unregister_push_token`).
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined';

export interface PushPlatform {
  /** The current answer. Never shows a prompt. */
  readonly permission: () => Promise<PushPermission>;
  /** This install's FCM registration token. */
  readonly deviceToken: () => Promise<string>;
  /** The Android channel the server's messages name (`default`). Idempotent. */
  readonly ensureChannel: () => Promise<void>;
}

export interface PushServer {
  readonly register: (token: string) => Promise<void>;
  readonly unregister: (token: string) => Promise<void>;
}

/** What this phone last registered, and for whom. */
export interface PushMemory {
  readonly read: () => Promise<{ readonly userId: string; readonly token: string } | null>;
  readonly write: (
    value: { readonly userId: string; readonly token: string } | null,
  ) => Promise<void>;
}

export interface PushDeps {
  readonly platform: PushPlatform;
  readonly server: PushServer;
  readonly memory: PushMemory;
}

export type RegisterOutcome = 'registered' | 'already' | 'no-permission' | 'failed';

/** Register this phone for `userId` if the rep has allowed notifications. Never throws. */
export const registerForPush = async (deps: PushDeps, userId: string): Promise<RegisterOutcome> => {
  try {
    if ((await deps.platform.permission()) !== 'granted') return 'no-permission';
    await deps.platform.ensureChannel();
    const token = (await deps.platform.deviceToken()).trim();
    if (token === '') return 'failed';
    const remembered = await deps.memory.read();
    if (remembered !== null && remembered.userId === userId && remembered.token === token) {
      return 'already';
    }
    await deps.server.register(token);
    await deps.memory.write({ userId, token });
    return 'registered';
  } catch {
    // No network, no Play services, the server refused: nothing registered, tried again next time.
    return 'failed';
  }
};

/**
 * Before sign-out: retire this phone's token for the person signing out. Bounded and never throws --
 * sign-out must not wait on a network that is not there. If it cannot reach the server, the next
 * person to sign in on this phone replaces the row anyway.
 */
export const unregisterForPush = async (deps: PushDeps, timeoutMs = 3_000): Promise<boolean> => {
  const remembered = await deps.memory.read().catch(() => null);
  if (remembered === null) return true;
  const attempt = deps.server
    .unregister(remembered.token)
    .then(() => true)
    .catch(() => false);
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });
  const done = await Promise.race([attempt, timeout]);
  await deps.memory.write(null).catch(() => undefined);
  return done;
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ALLOWED_LINKS: readonly RegExp[] = [
  /^\/beat-plan$/u,
  /^\/day-end$/u,
  /^\/learning$/u,
  new RegExp(`^/analysis/${UUID}$`, 'u'),
];

/**
 * Where tapping a notification opens. Only the screens the server's four kinds name; anything else
 * -- a malformed or unexpected link -- opens Today. A route that is switched off in this build sends
 * the rep to Today by itself.
 */
export const notificationLink = (data: unknown): string => {
  const link = (data as { link?: unknown } | null)?.link;
  return typeof link === 'string' && ALLOWED_LINKS.some((pattern) => pattern.test(link))
    ? link
    : '/home';
};
