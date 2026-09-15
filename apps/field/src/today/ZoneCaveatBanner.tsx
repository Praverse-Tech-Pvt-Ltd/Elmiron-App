import type { ReactNode } from 'react';
import { Banner } from '@fieldforce/ui';
import { usePulledStore } from '../sync/pulled-store';
import { zoneCaveat } from './territory-day';

/**
 * **`FE-W45`, second half — MR-36 C2.**
 *
 * Eleven screens render a date or a clock in the territory zone. None of them read the zone's
 * `source` discriminant, so an MR has never been able to tell a real territory timezone from
 * the UTC fallback the app uses when the server declines to say. For a territory in IST that
 * is 5 hours 30 minutes, which is enough to move a late visit onto the previous calendar day —
 * and which day a doctor was seen is a compliance fact, not a display preference.
 *
 * **One banner at the root rather than eleven edits.** Every one of those screens reads the
 * zone from `usePulledStore()`, which is mounted here, so the caveat belongs at the same level
 * as the thing it qualifies. Eleven separate warnings would be eleven places for the twelfth
 * screen to be forgotten — the `FE-W44` lesson, where MR-31 recorded two consumers and there
 * were five.
 *
 * It renders nothing at all when the zone is the territory's own, so the normal case carries no
 * cost and no noise.
 */
export const ZoneCaveatBanner = (): ReactNode => {
  const { zone } = usePulledStore();
  const caveat = zoneCaveat(zone);
  if (caveat === null) return null;

  // `attention` rather than `critical`: the dates shown are not confirmed wrong, they are
  // unconfirmed. Overstating it would train the MR to dismiss the banner that means "your
  // work is not saved".
  return <Banner tone="attention" title="Times may be wrong" detail={caveat} />;
};
