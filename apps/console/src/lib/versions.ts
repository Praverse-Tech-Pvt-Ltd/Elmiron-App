import type { ConsentRecord, ConsentTextVersion } from '@fieldforce/core';

/**
 * E3's arithmetic — the one console screen with real data behind it.
 *
 * The design says consent versioning is "the one place [admin] earns design
 * attention, because 'which notice did this doctor actually see' is the question
 * that gets asked in a dispute". Everything here exists to answer that question
 * from the ledger rather than from a summary somebody maintained by hand.
 */

export interface VersionRow {
  readonly id: string;
  readonly versionLabel: string;
  /** Every language this label was published in, in the server's order. */
  readonly languages: readonly string[];
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  /** Consents captured against this exact version id. */
  readonly consents: number;
  readonly live: boolean;
  /** First eight hex of the SHA-256 — what makes a version checkable. */
  readonly hashPrefix: string;
}

/**
 * One row per version label, with its languages folded in.
 *
 * The contract stores a row per language, so `v1.2` in English and `v1.2` in Hindi
 * are two `ConsentTextVersion`s. An admin asking "what changed in v1.2" means the
 * notice, not the translation, so the table groups by label — and the count of
 * consents is summed across the languages, because a consent given in Hindi is a
 * consent on that version.
 *
 * **`live` is computed from the dates, never from row order.** A version with an
 * `effectiveUntil` in the past is superseded whatever position it holds in the
 * response, and an admin reading "Live" off a stale sort is exactly the mistake
 * this column exists to prevent.
 */
export const versionRows = (
  versions: readonly ConsentTextVersion[],
  records: readonly ConsentRecord[],
  nowIso: string,
): readonly VersionRow[] => {
  const byLabel = new Map<string, ConsentTextVersion[]>();
  for (const version of versions) {
    byLabel.set(version.versionLabel, [...(byLabel.get(version.versionLabel) ?? []), version]);
  }

  const rows = [...byLabel.entries()].map(([versionLabel, group]) => {
    const ids = new Set(group.map((version) => version.id));
    const head = group[0];
    return {
      id: head?.id ?? versionLabel,
      versionLabel,
      languages: group.map((version) => version.language),
      effectiveFrom: head?.effectiveFrom ?? '',
      effectiveUntil: head?.effectiveUntil ?? null,
      consents: records.filter((record) => ids.has(record.consentTextVersionId)).length,
      live: group.some(
        (version) =>
          version.effectiveFrom <= nowIso &&
          (version.effectiveUntil === null || version.effectiveUntil > nowIso),
      ),
      hashPrefix: head?.hash.slice(0, 8) ?? '',
    };
  });

  // Newest first: an admin opening this is nearly always asking about the notice
  // in force, and the superseded ones are history below it.
  return rows.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
};

/** "14 Apr 2026" from a contract timestamp, sliced rather than parsed. */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const dateFrom = (iso: string): string => {
  if (iso === '') return '—';
  const day = Number(iso.slice(8, 10));
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  const year = iso.slice(0, 4);
  return month === undefined ? iso.slice(0, 10) : `${String(day)} ${month} ${year}`;
};
