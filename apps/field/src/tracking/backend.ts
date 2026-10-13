import { createLiveTrackingBackend } from './live';
import type { LiveTrackingBackend } from './live';

/**
 * `FE-W71` — the live backend on the device, as the signed-in rep.
 *
 * The connection is imported ON USE, as `capture/client.ts` imports the client: `live-connection`
 * imports `config`, which throws at module load on a missing `EXPO_PUBLIC_*` value — right for the
 * app, wrong for every route test that renders Today or Me with the tracker mounted and no `.env`.
 */
export const appLiveTrackingBackend = (): LiveTrackingBackend => {
  let made: LiveTrackingBackend | null = null;
  const real = async (): Promise<LiveTrackingBackend> => {
    if (made === null) {
      const { appLiveConnection } = await import('../live-connection');
      made = createLiveTrackingBackend(appLiveConnection());
    }
    return made;
  };
  return {
    status: async () => (await real()).status(),
    accept: async (noticeVersionId) => (await real()).accept(noticeVersionId),
    withdraw: async () => (await real()).withdraw(),
    ping: async (position) => (await real()).ping(position),
  };
};
