import type { AdminUser, Role, RetentionOverview, TerritoryNode } from '@fieldforce/core';
import { territoryLevel } from '@fieldforce/core';

/**
 * `FE-W75`–`FE-W78` — what the four admin screens say, in an admin's words.
 *
 * **Every refusal is the database's** (`20261013000200`…`20261013000230`). Each function there puts a
 * stable token at the start of its message (`rep_needs_manager`, `territory_too_deep`, …), and that
 * token is what is matched here — never a SQLSTATE alone, because `22023` means a dozen things on
 * these screens. Anything unrecognised is passed through unsoftened, so a new rule is never shown as
 * a generic failure.
 *
 * Pure, and outside the `'use client'` files, so it is tested without a renderer.
 */
export interface Refusal {
  readonly code?: string | null;
  readonly message: string;
}

const unsoftened = (message: string): string => `The server refused this: ${message}`;

const RULES: readonly (readonly [RegExp, string])[] = [
  [/not_an_admin/u, 'Only an active admin can do this.'],
  [
    /admin_confirmation_mismatch/u,
    'To make someone an admin, type their email address again exactly. Nothing was saved.',
  ],
  [
    /admin_has_no_territory/u,
    'An admin has no territory: leave the territory empty for the admin role.',
  ],
  [
    /admin_has_no_manager/u,
    'An admin has no reporting manager: leave the manager empty for the admin role.',
  ],
  [/territory_required/u, 'Choose a territory: field managers and reps must have one.'],
  [
    /territory_not_in_organisation/u,
    'That territory is not one of your company’s. Nothing was saved.',
  ],
  [
    /territory_level_for_rep/u,
    'A rep goes on an Area/Territory — the lowest level of its branch — not on a National or Region territory.',
  ],
  [
    /rep_needs_manager/u,
    'Choose the rep’s reporting manager. Without one, nobody sees their work.',
  ],
  [
    /manager_invalid/u,
    'The manager must be an active field manager or admin of your company, and not the person themselves.',
  ],
  [
    /manager_does_not_cover_territory/u,
    'That manager’s territory does not include this one, so they could not plan or review this rep. Choose a manager who covers it.',
  ],
  [/email_invalid/u, 'That is not an email address.'],
  [/name_required/u, 'Give the person’s full name.'],
  [/account_exists/u, 'Someone with that email address already has an account.'],
  [
    /provisioning_open/u,
    'A creation for that email address is already in progress — finish or cancel it below.',
  ],
  [/provisioning_not_found/u, 'That creation is not one of your company’s.'],
  [/provisioning_closed/u, 'That creation was already finished or cancelled. Reload the page.'],
  [
    /account_missing/u,
    'The sign-in account does not exist yet. Cancel this creation and create the user again.',
  ],
  [
    /account_unconfirmed/u,
    'The sign-in account is not confirmed, so it could not sign in. It must be confirmed in the Supabase dashboard (or cancelled and created again here) before it can be finished.',
  ],
  [/self_role_change/u, 'You cannot change your own role. Another admin must.'],
  [/self_deactivate/u, 'You cannot deactivate yourself. Another admin must.'],
  [/self_password_reset/u, 'Reset your own password from the sign-in page, not here.'],
  [/has_reports/u, 'People still report to this person. Give them another manager first.'],
  [
    /reports_outside_territory/u,
    'Some of this manager’s reps are outside that territory. Give them another manager first, or choose a territory that contains theirs.',
  ],
  [/user_not_found/u, 'That user is not one of your company’s.'],
  [/reason_required/u, 'Say why — the reason is kept in the audit log.'],
  [/territory_name_required/u, 'Give the territory a name.'],
  [
    /territory_code_invalid/u,
    'A code is 1–40 letters, digits, “-” or “_”, and never starts with EXAMPLE-.',
  ],
  [
    /territory_code_taken/u,
    'That code is already used. Codes are unique across the whole system, not only your company.',
  ],
  [/territory_too_deep/u, 'An Area/Territory is the lowest level. Nothing goes beneath it.'],
  [
    /parent_has_reps/u,
    'Reps sit on that territory, so it must stay the lowest level. Move them first.',
  ],
  [/hours_invalid/u, 'The working day must end after it starts, on the same day.'],
  [/timezone_unknown/u, 'That is not a time zone name (for example, Asia/Kolkata).'],
  [/grace_invalid/u, 'Grace is 0 to 240 minutes.'],
  [/weekdays_invalid/u, 'Choose at least one working day.'],
  [/range_invalid/u, 'The end of the date range is before its start.'],
  [/action_unknown/u, 'That is not an action the audit log records.'],
  [
    /not_configured/u,
    'This server cannot create sign-in accounts or reset passwords: the Edge Function has no secret key. Nothing was changed.',
  ],
  [
    /account_create_failed/u,
    'The sign-in account could not be created. Nothing was created; the reason is below.',
  ],
  [/password_reset_failed/u, 'The password could not be reset. The old password still works.'],
];

/** One sentence for a refusal from any of the four screens' functions. */
export const adminRefusal = ({ code, message }: Refusal): string => {
  for (const [pattern, sentence] of RULES) {
    if (pattern.test(message) || (code !== undefined && code !== null && pattern.test(code))) {
      return sentence;
    }
  }
  return unsoftened(message);
};

export const roleLabel = (role: Role): string =>
  ({ mr: 'Rep (MR)', field_manager: 'Field manager', admin: 'Admin' })[role];

/** How a territory reads in a picker: level, code and name, so a wrong one is visible. */
export const territoryOption = (node: Pick<TerritoryNode, 'depth' | 'code' | 'name'>): string =>
  `${territoryLevel(node.depth)} · ${node.code} — ${node.name}`;

/**
 * The territories a role may be placed on — the database's rule, applied here only to keep the
 * picker short. A rep: the bottom of a branch below the top. A manager: any. An admin: none.
 */
export const territoriesFor = (
  role: Role,
  nodes: readonly Pick<TerritoryNode, 'id' | 'parentId' | 'children' | 'depth' | 'code' | 'name'>[],
): readonly Pick<TerritoryNode, 'id' | 'parentId' | 'children' | 'depth' | 'code' | 'name'>[] => {
  if (role === 'admin') return [];
  if (role === 'mr') return nodes.filter((n) => n.parentId !== null && n.children === 0);
  return nodes;
};

/** The people who may be a reporting manager: active field managers and admins, never oneself. */
export const managersFor = (
  users: readonly Pick<AdminUser, 'id' | 'role' | 'isActive'>[],
  self: string | null,
): readonly string[] =>
  users
    .filter(
      (u) => u.isActive && (u.role === 'field_manager' || u.role === 'admin') && u.id !== self,
    )
    .map((u) => u.id);

/** What the Users screen asks about a person's state, beyond their role. */
export const accessWarnings = (
  user: Pick<AdminUser, 'role' | 'confirmed' | 'managerId' | 'isActive'>,
): readonly string[] => {
  const out: string[] = [];
  if (!user.confirmed) out.push('Cannot sign in: the account is not confirmed.');
  if (user.isActive && user.role === 'mr' && user.managerId === null) {
    out.push('No reporting manager: nobody sees this rep’s work.');
  }
  return out;
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** `[1,2,3,4,5,6]` -> `Mon–Sat`; a broken run is listed. ISO weekdays, Monday = 1. */
export const weekdaysLabel = (days: readonly number[]): string => {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (sorted.length === 0) return 'No working days';
  const contiguous = sorted.every((d, i) => i === 0 || d === (sorted[i - 1] ?? 0) + 1);
  const name = (d: number): string => WEEKDAYS[d - 1] ?? String(d);
  if (contiguous && sorted.length > 2)
    return `${name(sorted[0] ?? 1)}–${name(sorted[sorted.length - 1] ?? 7)}`;
  return sorted.map(name).join(', ');
};

/**
 * The tree in reading order — each territory followed by everything beneath it, siblings by code —
 * with its depth below the first visible level (a manager's subtree starts at their own territory).
 * A node whose parent is not visible is a root of what is shown.
 */
export const treeOrder = <T extends Pick<TerritoryNode, 'id' | 'parentId' | 'code'>>(
  nodes: readonly T[],
): readonly { readonly node: T; readonly indent: number }[] => {
  const ids = new Set(nodes.map((n) => n.id));
  const byParent = new Map<string | null, T[]>();
  for (const n of nodes) {
    const key = n.parentId !== null && ids.has(n.parentId) ? n.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), n]);
  }
  const out: { node: T; indent: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, indent: number): void => {
    const children = [...(byParent.get(parent) ?? [])].sort((a, b) => a.code.localeCompare(b.code));
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push({ node: child, indent });
      walk(child.id, indent + 1);
    }
  };
  walk(null, 0);
  return out;
};

/**
 * A calendar day typed into the audit filter, as the instant it starts in India time — the zone the
 * company default hours use. `until` is inclusive on screen, so the bound sent is the NEXT day's start.
 */
export const dayStart = (day: string): string | null =>
  /^\d{4}-\d{2}-\d{2}$/u.test(day) ? `${day}T00:00:00+05:30` : null;

export const dayAfterStart = (day: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return null;
  const next = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(next.getTime())) return null;
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T00:00:00+05:30`;
};

/** `09:00:00` -> `09:00`. */
export const clock = (time: string): string => time.slice(0, 5);

/** Where a territory's hours come from, in words. */
export const hoursSource = (
  node: Pick<TerritoryNode, 'ownHours' | 'hours'>,
  codeOf: (id: string) => string | undefined,
): string => {
  if (node.ownHours !== null) return 'Its own hours';
  if (node.hours === null) return 'No hours apply — check-in is refused here until some are set';
  if (node.hours.source === 'org_default') return 'The company default';
  const from = node.hours.resolvedFromTerritoryId;
  return `Inherited from ${from === null ? 'a parent' : (codeOf(from) ?? 'a parent')}`;
};

/**
 * What the retention screen must say first, if anything. The database's `stalled` is the verdict
 * that also refuses new uploads, so it is the critical one; overdue audio without a stall is the
 * worker being behind, not stopped.
 */
export const retentionAlerts = (
  overview: RetentionOverview,
): readonly { tone: 'critical' | 'attention'; text: string }[] => {
  const out: { tone: 'critical' | 'attention'; text: string }[] = [];
  if (overview.worker.stalled) {
    out.push({
      tone: 'critical',
      text: 'The retention worker is stalled: audio is past its purge date across the system, and new recordings are being refused until it catches up.',
    });
  }
  const overdue = overview.yours.overdueRecordings + overview.yours.overdueVoiceNotes;
  if (overdue > 0) {
    out.push({
      tone: 'attention',
      text: `${String(overdue)} of your company’s audio object(s) are past their purge date and not yet destroyed.`,
    });
  }
  if (overview.worker.lastRunAt === null) {
    out.push({
      tone: 'attention',
      text: 'The retention worker has never run against this database. On a deployment, the scheduled “Audio retention” workflow runs it hourly.',
    });
  } else if (overview.runs[0]?.outcome === 'failed') {
    out.push({ tone: 'attention', text: 'The most recent run failed on at least one object.' });
  }
  return out;
};
