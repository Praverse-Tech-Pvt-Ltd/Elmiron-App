import { WorkDayRequestSchema } from '@fieldforce/core';
import type {
  SyncQueueItem,
  Visit,
  WorkDay,
  WorkDayAction,
  WorkDayRequest,
} from '@fieldforce/core';
import type { LocalStore } from '../sync/pull';

/**
 * `FE-W80` / `BE-W190` — the rep's WORKING DAY, read from the pulled store and the phone's queue.
 *
 * **The server's record is the answer; the phone only says what it is still sending.** A day is
 * opened by the rep's first check-in or an explicit start, and ended by "End my day" — both on the
 * server (`20261013000310_work_days`), which stamps them and snapshots the totals. The pull carries
 * the row. What the phone adds is only what it witnessed and has not yet seen come back: an end
 * pressed with no signal is `ending` (not sent), or `ending` and sent (the pull that confirms it
 * has not landed). Nothing here decides a day is closed on the phone's word.
 *
 * **For live tracking: `isDayOpen(workDayStatus(...))` is the `dayOpen` input of `trackingState`
 * (`src/integrations/tracking.ts`).** It is true only while the day is OPEN — started or checked
 * into, not ended and not being ended — and false when it has not started, when the rep has pressed
 * "End my day" (sent or not: they have ended it, so tracking stops at once), when the server has
 * ended it, and when there is no server day to read (`unknown`: no pull yet, no sign-in).
 *
 * Pure, so it is tested without a renderer, like the rest of `today/`.
 */
export type WorkDayStatus =
  /** No server day to reckon by (no pull has answered), or nobody signed in. */
  | { readonly kind: 'unknown' }
  /** Neither the server nor this phone has opened the day. */
  | { readonly kind: 'not_started' }
  /**
   * Open. `day` is the server's row, or null while only this phone's "start my day" is waiting to
   * be sent (`pendingStart`).
   */
  | { readonly kind: 'open'; readonly day: WorkDay | null; readonly pendingStart: boolean }
  /**
   * The rep pressed "End my day" and the server's closed row has not reached this phone yet.
   * `sent`: the server has accepted it; the pull that brings its stamp has not landed.
   */
  | {
      readonly kind: 'ending';
      readonly day: WorkDay | null;
      readonly sent: boolean;
      readonly requestId: string;
    }
  /** Ended, on the server's word, with the server's stamp and snapshot. */
  | { readonly kind: 'closed'; readonly day: WorkDay };

/** The server's row for this rep and date, or null. */
export const workDayFor = (
  store: Pick<LocalStore, 'work_day'>,
  mrId: string,
  date: string,
): WorkDay | null =>
  [...store.work_day.values()].find((day) => day.mrId === mrId && day.workDate === date) ?? null;

interface PhoneAct {
  readonly item: SyncQueueItem;
  readonly action: WorkDayAction;
}

/** This phone's `work_day` acts for `date`, oldest first, with their action. Refused ones excluded. */
const phoneActs = (items: readonly SyncQueueItem[], date: string): PhoneAct[] =>
  items.flatMap((item): PhoneAct[] => {
    // A refused act is the server's "no". It changes nothing about the day; the queue screen and
    // the Day End screen say why.
    if (item.entity !== 'work_day' || item.status === 'failed' || item.status === 'conflict') {
      return [];
    }
    const parsed = WorkDayRequestSchema.safeParse(item.payload);
    if (!parsed.success || parsed.data.workDate !== date) return [];
    return [{ item, action: parsed.data.action }];
  });

/**
 * Has the server's row caught up with an act this phone sent?
 *
 * An unsent act never has. A sent one has once the row was written AFTER the server accepted it:
 * `syncedAt` is the server's clock at acceptance (`sync_push`'s `serverTime`), and the row's
 * `updatedAt` is the server's too, so the comparison is between two server instants. A row that
 * moved later -- the close it brought, or a manager's reopening -- is the newer word and wins.
 * Instants, not days, so parsing them is safe: no calendar is read from either.
 */
const reflected = (act: PhoneAct, day: WorkDay | null): boolean => {
  if (act.item.status !== 'synced') return false;
  if (day === null) return false;
  if (act.item.syncedAt === null) return true;
  return Date.parse(day.updatedAt) >= Date.parse(act.item.syncedAt);
};

export const workDayStatus = (
  store: Pick<LocalStore, 'work_day'>,
  mrId: string | null,
  today: string | null,
  items: readonly SyncQueueItem[],
): WorkDayStatus => {
  if (mrId === null || today === null) return { kind: 'unknown' };
  const day = workDayFor(store, mrId, today);
  // Closed on the server is final for this phone; only a manager changes it, and the pull says so.
  if (day?.closedAt != null) return { kind: 'closed', day };

  const pending = phoneActs(items, today).filter((act) => !reflected(act, day));
  const last = pending[pending.length - 1];
  if (last?.action === 'close') {
    return { kind: 'ending', day, sent: last.item.status === 'synced', requestId: last.item.id };
  }
  if (day !== null) return { kind: 'open', day, pendingStart: false };
  if (last?.action === 'open') return { kind: 'open', day: null, pendingStart: true };
  return { kind: 'not_started' };
};

/**
 * **The selector for the live-tracking rule's `dayOpen`.** See the module note: open means started
 * and not ended — not "the server has a row".
 */
export const isDayOpen = (status: WorkDayStatus): boolean => status.kind === 'open';

/**
 * Why "End my day" cannot be pressed yet, or null when it can.
 *
 * Read from the visits AS THIS PHONE WITNESSED THEM (`visitsAsWitnessed`), so a check-out made with
 * no signal counts as a check-out here: the outbox sends it before the close, and the server then
 * agrees. The server refuses the same thing (45016) whatever this says.
 */
export const endDayBlocker = (visitsToday: readonly Visit[]): string | null => {
  const open = visitsToday.filter((visit) => visit.status === 'in_progress').length;
  if (open === 0) return null;
  return open === 1
    ? 'A visit is still checked in. Check out of it first, then end your day.'
    : `${String(open)} visits are still checked in. Check out of them first, then end your day.`;
};

/**
 * The request, parsed by the contract. `workDate` is the server's day the screen showed;
 * `occurredAt` is the phone's record of the press, which the server bounds and keeps beside its own.
 */
export const workDayRequest = (args: {
  readonly id: string;
  readonly action: WorkDayAction;
  readonly workDate: string;
  readonly occurredAt: string;
  readonly note?: string | null;
}): WorkDayRequest => {
  const note = args.note?.trim() ?? '';
  return WorkDayRequestSchema.parse({
    id: args.id,
    action: args.action,
    workDate: args.workDate,
    occurredAt: args.occurredAt,
    note: args.action === 'close' && note !== '' ? note : null,
  });
};
