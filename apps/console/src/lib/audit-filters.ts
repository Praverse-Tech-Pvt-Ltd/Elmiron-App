import { AUDIT_ACTIONS } from '@fieldforce/core';

/**
 * `FE-W77` — the audit screen's filters, read from the URL and written back into it. Pure, so the
 * parsing is tested without a request: anything malformed is dropped rather than sent, because a
 * filter the server refuses would turn the page into a refusal for a typo in an address bar.
 */
export interface AuditFilters {
  readonly actor: string | null;
  readonly table: string | null;
  readonly action: (typeof AUDIT_ACTIONS)[number] | null;
  readonly from: string | null;
  readonly until: string | null;
  readonly before: number | null;
  readonly refused: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const TABLE = /^[a-z_][a-z0-9_.]{0,62}$/u;

const one = (value: string | string[] | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return v === undefined || v.trim() === '' ? null : v.trim();
};

export const readAuditFilters = (
  params: Readonly<Record<string, string | string[] | undefined>>,
): AuditFilters => {
  const actor = one(params['actor']);
  const table = one(params['table']);
  const action = one(params['action']);
  const from = one(params['from']);
  const until = one(params['until']);
  const before = one(params['before']);
  const beforeId = before !== null && /^\d{1,18}$/u.test(before) ? Number(before) : null;
  return {
    actor: actor !== null && UUID.test(actor) ? actor : null,
    table: table !== null && TABLE.test(table) ? table : null,
    action: AUDIT_ACTIONS.find((a) => a === action) ?? null,
    from: from !== null && DAY.test(from) ? from : null,
    until: until !== null && DAY.test(until) ? until : null,
    before: beforeId !== null && beforeId > 0 ? beforeId : null,
    refused: one(params['refused']) === '1',
  };
};

/** The `/audit` link for a set of filters; empty ones are left out. */
export const auditQuery = (filters: AuditFilters): string => {
  const query = new URLSearchParams();
  if (filters.actor !== null) query.set('actor', filters.actor);
  if (filters.table !== null) query.set('table', filters.table);
  if (filters.action !== null) query.set('action', filters.action);
  if (filters.from !== null) query.set('from', filters.from);
  if (filters.until !== null) query.set('until', filters.until);
  if (filters.refused) query.set('refused', '1');
  if (filters.before !== null) query.set('before', String(filters.before));
  const text = query.toString();
  return text === '' ? '/audit' : `/audit?${text}`;
};
