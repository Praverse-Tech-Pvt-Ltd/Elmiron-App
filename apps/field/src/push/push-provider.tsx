import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushEnabled } from '../features';
import { useSession } from '../session';
import { setBeforeSignOut } from './before-sign-out';
import { notificationLink, registerForPush, unregisterForPush } from './registration';
import type { PushDeps, PushMemory, PushPermission } from './registration';

/**
 * `FE-W86` — push notifications on the phone: register this install's FCM token after sign-in,
 * retire it before sign-out, and open the right screen when a notification is tapped.
 *
 * **A passthrough unless the build has `EXPO_PUBLIC_PUSH=true`** -- which a build cannot have without
 * a Firebase `google-services.json` (`plugins/maps-push.cjs`). Off, `expo-notifications` is never even
 * loaded: it is imported on use, below, so no native call is made and nothing is asked.
 *
 * Nothing here asks for the notification permission (see `registration.ts`): first run asks, with the
 * types named. A registration is re-tried each time the app comes back on screen, so allowing
 * notifications later in Settings starts them without signing in again.
 */
const MEMORY_KEY = 'push:registration';

const memory: PushMemory = {
  read: async () => {
    const raw = await AsyncStorage.getItem(MEMORY_KEY);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as { userId?: unknown; token?: unknown };
      return typeof value.userId === 'string' && typeof value.token === 'string'
        ? { userId: value.userId, token: value.token }
        : null;
    } catch {
      return null;
    }
  },
  write: async (value) => {
    if (value === null) await AsyncStorage.removeItem(MEMORY_KEY);
    else await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(value));
  },
};

/** The real platform and server, loaded on first use only. */
const appDeps = async (): Promise<PushDeps> => {
  const Notifications = await import('expo-notifications');
  const { appLiveConnection } = await import('../live-connection');
  const { createPushServer } = await import('./server');
  return {
    memory,
    server: createPushServer(appLiveConnection()),
    platform: {
      permission: async (): Promise<PushPermission> => {
        const answer = await Notifications.getPermissionsAsync();
        if (answer.granted) return 'granted';
        return answer.canAskAgain ? 'undetermined' : 'denied';
      },
      deviceToken: async () => String((await Notifications.getDevicePushTokenAsync()).data),
      ensureChannel: async () => {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Updates from your company',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      },
    },
  };
};

export const PushProvider = ({ children }: { readonly children: ReactNode }): ReactNode =>
  pushEnabled ? <WithPush>{children}</WithPush> : children;

const WithPush = ({ children }: { readonly children: ReactNode }): ReactNode => {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  // Register on sign-in, and again whenever the app comes back on screen.
  useEffect(() => {
    if (userId === null) return undefined;
    let live = true;
    const attempt = (): void => {
      void appDeps()
        .then((deps) => (live ? registerForPush(deps, userId) : null))
        .catch(() => undefined);
    };
    attempt();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') attempt();
    });
    const clear = setBeforeSignOut(async () => unregisterForPush(await appDeps()));
    return () => {
      live = false;
      subscription.remove();
      clear();
    };
  }, [userId]);

  // Show a notification that arrives while the app is open; open its screen when it is tapped.
  useEffect(() => {
    const state = { live: true };
    let remove: (() => void) | null = null;
    void import('expo-notifications')
      .then((Notifications) => {
        if (!state.live) return;
        Notifications.setNotificationHandler({
          handleNotification: () =>
            Promise.resolve({
              shouldShowBanner: true,
              shouldShowList: true,
              shouldPlaySound: false,
              shouldSetBadge: false,
            }),
        });
        const open = (data: unknown): void => {
          router.push(notificationLink(data));
        };
        const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          open(response.notification.request.content.data);
        });
        remove = () => {
          subscription.remove();
        };
        // The tap that launched the app from cold.
        const last = Notifications.getLastNotificationResponse();
        if (last !== null) open(last.notification.request.content.data);
      })
      .catch(() => undefined);
    return () => {
      state.live = false;
      remove?.();
    };
  }, [router]);

  return children;
};
