import { t } from '@fieldforce/ui/i18n';
/**
 * `FE-W137` — how much THIS APP has sent over mobile data this month, and when that earns a note.
 *
 * **What is counted, exactly, because the number will be believed.** C4 drew "84 MB of your plan"
 * and `settings/content.ts` refused to show it: nothing measured it, and an MR deciding whether to
 * keep WiFi-only on reads that number first. This counts one thing and says so wherever it is shown:
 *
 *   * the bytes of each upload THIS APP made that the server ACCEPTED while the phone was NOT on
 *     WiFi -- an audio file's own size, plus the small request that files it; for every other write,
 *     the request body sent to `sync_push`.
 *
 * And it does not count: downloads (the day's plan, doctors, lessons), request headers, retries that
 * got no answer, other apps, or anything the phone did before this build. So it is a FLOOR on this
 * app's share of the data plan, never "your data usage", and every sentence that shows it says
 * "this app's uploads".
 *
 * **The month is India's, read from the SERVER's clock.** Each accepted upload carries the server's
 * time (`PushAccepted.receivedAt`), and that is what decides which month it belongs to -- never the
 * handset's clock, which this app does not let decide "which month" (`eslint.config.js`). India has
 * no daylight saving, so India's date is UTC + 05:30 all year.
 */

/** The month a server instant falls in, in India: `YYYY-MM`. Null when the instant does not parse. */
export const indiaMonthOf = (serverTime: string): string | null => {
  const instant = Date.parse(serverTime);
  if (Number.isNaN(instant)) return null;
  // `new Date(ms)` PARSES an instant the server gave; it does not read the handset's clock.
  return new Date(instant + IST_OFFSET_MS).toISOString().slice(0, 7);
};

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** What is kept on the phone: one month, and its total. A new month replaces it. */
export interface DataUseRecord {
  readonly month: string;
  readonly bytes: number;
}

/**
 * Add an accepted upload's bytes to the month it belongs to.
 *
 * A later month starts the count again -- that IS the monthly reset, and it needs no timer: the first
 * upload of a new month replaces last month's record. An answer from an EARLIER month than the
 * record (a slow send finishing just after midnight on the 1st) belongs to a month already over, so
 * it changes nothing rather than inflating the new one.
 */
export const accrue = (
  record: DataUseRecord | null,
  bytes: number,
  serverTime: string,
): DataUseRecord | null => {
  const month = indiaMonthOf(serverTime);
  if (month === null || !Number.isFinite(bytes) || bytes <= 0) return record;
  if (record === null || month > record.month) return { month, bytes: Math.round(bytes) };
  if (month < record.month) return record;
  return { month, bytes: record.bytes + Math.round(bytes) };
};

/** This month's total, as of a server instant. A record from another month is zero this month. */
export const usedThisMonth = (record: DataUseRecord | null, serverTime: string | null): number => {
  if (record === null || serverTime === null) return 0;
  return indiaMonthOf(serverTime) === record.month ? record.bytes : 0;
};

/**
 * The threshold the setting is named for. Decimal megabytes -- 100,000,000 bytes -- because that is
 * how Android's own data-usage screen and Indian mobile plans count a megabyte.
 */
export const MONTHLY_NOTE_BYTES = 100 * 1000 * 1000;

/** `12.4 MB`, `0.3 MB`, `140 MB`. Decimal, matching `MONTHLY_NOTE_BYTES`. */
export const megabytes = (bytes: number): string => {
  const mb = bytes / (1000 * 1000);
  return t('common.megabytes', { mb: mb >= 100 ? String(Math.round(mb)) : mb.toFixed(1) });
};

/**
 * The note on Today, or null. **Attention, never critical, and it stops nothing** -- the setting's
 * own promise is "a note on home, nothing stops working". Null when the switch is off, when there is
 * no server instant to say which month it is, and at or under the threshold.
 */
export const dataNoteFor = (args: {
  readonly warnOn: boolean;
  readonly record: DataUseRecord | null;
  readonly serverTime: string | null;
}): { readonly title: string; readonly detail: string } | null => {
  if (!args.warnOn) return null;
  const used = usedThisMonth(args.record, args.serverTime);
  if (used <= MONTHLY_NOTE_BYTES) return null;
  return {
    title: t('data.noteTitle', { size: megabytes(used) }),
    detail: t('data.noteDetail'),
  };
};

/**
 * UTF-8 length of a string: what a JSON request body costs on the wire. Counted by hand so the count
 * does not depend on `TextEncoder` being present in the JS engine.
 */
export const utf8Length = (text: string): number => {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};

/** A stored record, or null for anything that is not one. A corrupt value counts nothing. */
export const dataUseFrom = (raw: string | null): DataUseRecord | null => {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { month, bytes } = parsed as { month?: unknown; bytes?: unknown };
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/u.test(month)) return null;
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    return { month, bytes };
  } catch {
    return null;
  }
};
