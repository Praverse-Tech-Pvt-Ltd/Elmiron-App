import { z } from 'zod';
import { RoleSchema } from '../shared/identity.js';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * The console's four admin screens — Users & roles (`BE-W185`, `BE-W186`), Territories (`BE-W187`),
 * the Audit log (`BE-W188`) and Retention & purge (`BE-W189`).
 *
 * Every read and write is one of these RPCs, run as the signed-in user; the database decides who may
 * do what (`20261013000200`…`20261013000230`). The one exception is making a SIGN-IN ACCOUNT, which
 * only GoTrue's admin API can do: that is the `admin-accounts` Edge Function, which itself calls the
 * RPCs below as the caller before and after. The schemas parse exactly what each returns, so the
 * console and the database tests read one shape.
 */
export const ADMIN_RPC = {
  /** Admin. The company's users and the creations started and not finished. Audited, needs a reason. */
  listUsers: 'admin_list_users',
  /** Admin, via `admin-accounts`. Validates a new user and records the creation as started. */
  beginUserCreation: 'admin_begin_user_creation',
  /** Admin. Makes the profile once the sign-in account exists and is confirmed. */
  finishUserCreation: 'admin_finish_user_creation',
  /** Admin. Abandons a started creation, with a reason. */
  cancelUserCreation: 'admin_cancel_user_creation',
  /** Admin. Name, role, territory and manager, checked as one combination; with a reason. */
  updateUser: 'admin_update_user',
  /** Admin. Deactivate or reactivate; never a delete. With a reason. */
  setUserActive: 'admin_set_user_active',
  /** Admin, via `admin-accounts`. Says a password may be reset, and audits the request. */
  authorizePasswordReset: 'admin_authorize_password_reset',
  /** Admin, or a field manager for their own subtree (read-only). */
  territoryTree: 'territory_tree',
  /** Admin. National -> Region -> Area/Territory; codes unique across every company. */
  createTerritory: 'admin_create_territory',
  /** Admin. A territory is renamed, never deleted. */
  renameTerritory: 'admin_rename_territory',
  /** Admin. A territory's own working hours. */
  setTerritoryHours: 'admin_set_territory_hours',
  /** Admin. Removes a territory's own hours, so it inherits again. */
  clearTerritoryHours: 'admin_clear_territory_hours',
  /** Admin. The audit log, filtered and paged. Audited, needs a reason. */
  searchAuditLog: 'search_audit_log',
  /** Admin. The retention worker's runs and the company's audio figures. Audited, needs a reason. */
  retentionOverview: 'retention_overview',
} as const;

/** The Edge Function that creates sign-in accounts and resets passwords (`BE-W186`). */
export const ADMIN_ACCOUNTS_FUNCTION = 'admin-accounts';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const AdminUserSchema = z.object({
  id: UuidSchema,
  /** Null only if the sign-in account was removed outside this system. */
  email: z.string().nullable(),
  fullName: z.string(),
  role: RoleSchema,
  territoryId: UuidSchema.nullable(),
  territoryName: z.string().nullable(),
  territoryCode: z.string().nullable(),
  managerId: UuidSchema.nullable(),
  managerName: z.string().nullable(),
  isActive: z.boolean(),
  /** The sign-in account's email is confirmed: false means this person cannot sign in. */
  confirmed: z.boolean(),
  lastSignInAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  /** Active people whose reporting manager this is. */
  activeReports: z.number().int().nonnegative(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

/** A creation started and not finished — the account may exist without its profile. */
export const PendingUserSchema = z.object({
  id: UuidSchema,
  email: z.string(),
  fullName: z.string(),
  role: RoleSchema,
  territoryId: UuidSchema.nullable(),
  managerId: UuidSchema.nullable(),
  adoptExisting: z.boolean(),
  requestedAt: IsoDateTimeSchema,
  requestedBy: z.string(),
  accountExists: z.boolean(),
  accountConfirmed: z.boolean(),
  accountHasProfile: z.boolean(),
});
export type PendingUser = z.infer<typeof PendingUserSchema>;

export const AdminUserListSchema = z.object({
  users: z.array(AdminUserSchema),
  pending: z.array(PendingUserSchema),
  readAt: IsoDateTimeSchema,
  auditLogId: z.number().int().positive(),
});
export type AdminUserList = z.infer<typeof AdminUserListSchema>;

/** What `admin_begin_user_creation` answers. `existingAccount`: a profile-less account is adopted. */
export const UserCreationStartSchema = z.object({
  provisioningId: UuidSchema,
  email: z.string(),
  existingAccount: z.boolean(),
});
export type UserCreationStart = z.infer<typeof UserCreationStartSchema>;

/** The `admin-accounts` request bodies. */
export interface CreateAccountRequest {
  readonly action: 'create';
  readonly email: string;
  readonly fullName: string;
  readonly role: z.infer<typeof RoleSchema>;
  readonly territoryId: string | null;
  readonly managerId: string | null;
  /** The new person's email typed a second time; required for the admin role. */
  readonly adminConfirmation: string | null;
}
export interface ResetPasswordRequest {
  readonly action: 'reset_password';
  readonly userId: string;
  readonly reason: string;
}

/**
 * What `admin-accounts` answers on success. `temporaryPassword` is shown ONCE and never stored; it is
 * null when an existing account was adopted (its password is unchanged).
 */
export const AccountOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.enum(['created', 'adopted']),
    user: AdminUserSchema,
    temporaryPassword: z.string().nullable(),
  }),
  z.object({
    /** The account was made; its profile was refused. The Users screen lists it until finished. */
    outcome: z.literal('incomplete'),
    provisioningId: UuidSchema,
    email: z.string(),
    temporaryPassword: z.string().nullable(),
    refusal: z.object({ code: z.string(), message: z.string() }),
  }),
  z.object({
    outcome: z.literal('password_reset'),
    userId: UuidSchema,
    email: z.string().nullable(),
    temporaryPassword: z.string(),
  }),
]);
export type AccountOutcome = z.infer<typeof AccountOutcomeSchema>;

/** What `admin-accounts` answers when it refuses: the database's own code and words, or its own. */
export const AccountRefusalSchema = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().nullable().optional(),
});
export type AccountRefusal = z.infer<typeof AccountRefusalSchema>;

// ---------------------------------------------------------------------------
// Territories
// ---------------------------------------------------------------------------

const HoursFields = {
  shiftStart: z.string(),
  shiftEnd: z.string(),
  timezone: z.string(),
  graceMinutes: z.number().int().nonnegative(),
  activeWeekdays: z.array(z.number().int().min(1).max(7)),
};

export const TerritoryNodeSchema = z.object({
  id: UuidSchema,
  parentId: UuidSchema.nullable(),
  name: z.string(),
  code: z.string(),
  /** 1 = National, 2 = Region, 3 = Area/Territory. The table stores no level; depth is the level. */
  depth: z.number().int().positive(),
  children: z.number().int().nonnegative(),
  activeUsers: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative(),
  doctors: z.number().int().nonnegative(),
  /** This territory's OWN hours, or null when it inherits. */
  ownHours: z.object(HoursFields).nullable(),
  /** The hours that apply, as `resolve_shift_window` resolves them; null when none apply at all. */
  hours: z
    .object({
      ...HoursFields,
      source: z.enum(['territory', 'org_default']),
      resolvedFromTerritoryId: UuidSchema.nullable(),
    })
    .nullable(),
});
export type TerritoryNode = z.infer<typeof TerritoryNodeSchema>;

export const TerritoryTreeSchema = z.object({
  canEdit: z.boolean(),
  territories: z.array(TerritoryNodeSchema),
});
export type TerritoryTree = z.infer<typeof TerritoryTreeSchema>;

/** The level name for a depth, as the operator's territory sheet names them. */
export const territoryLevel = (depth: number): 'National' | 'Region' | 'Area/Territory' =>
  depth <= 1 ? 'National' : depth === 2 ? 'Region' : 'Area/Territory';

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = ['insert', 'update', 'delete', 'select'] as const;

export const AuditSearchRowSchema = z.object({
  id: z.number().int().positive(),
  actorId: UuidSchema,
  actorName: z.string(),
  actorRole: RoleSchema.nullable(),
  action: z.enum(AUDIT_ACTIONS),
  tableName: z.string().min(1),
  rowId: z.string().nullable(),
  occurredAt: IsoDateTimeSchema,
  reason: z.string().nullable(),
  refused: z.boolean(),
});
export type AuditSearchRow = z.infer<typeof AuditSearchRowSchema>;

export const AuditSearchSchema = z.object({
  data: z.array(AuditSearchRowSchema),
  /** Pass as `p_before_id` for the next page; null on the last page. */
  nextBeforeId: z.number().int().positive().nullable(),
  /** The tables that appear in the company's trail, for the filter. */
  tables: z.array(z.string()),
  readAt: IsoDateTimeSchema,
  auditLogId: z.number().int().positive(),
  systemRowsHidden: z.number().int().nonnegative(),
});
export type AuditSearch = z.infer<typeof AuditSearchSchema>;

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export const RetentionRunSchema = z.object({
  id: UuidSchema,
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
  outcome: z.enum(['succeeded', 'failed', 'unfinished']),
  /** This company's objects the run destroyed. Never the run's whole-system count. */
  destroyedForYou: z.number().int().nonnegative(),
});
export type RetentionRun = z.infer<typeof RetentionRunSchema>;

const count = z.number().int().nonnegative();

export const RetentionOverviewSchema = z.object({
  retentionDays: z.number().int().positive(),
  thresholds: z.object({
    purgeBatchLimit: z.number().nonnegative(),
    purgeBacklogMultiplier: z.number().nonnegative(),
    purgeMaxSilenceHours: z.number().nonnegative(),
  }),
  yours: z.object({
    liveRecordings: count,
    liveVoiceNotes: count,
    overdueRecordings: count,
    overdueVoiceNotes: count,
    destroyedRecordings: count,
    destroyedVoiceNotes: count,
    oldestOverdueAt: IsoDateTimeSchema.nullable(),
  }),
  worker: z.object({
    lastRunAt: IsoDateTimeSchema.nullable(),
    lastSuccessfulRunAt: IsoDateTimeSchema.nullable(),
    /** The database's own verdict: when true, new audio uploads are already being refused. */
    stalled: z.boolean(),
  }),
  runs: z.array(RetentionRunSchema),
  /** Tables `reject_mutation` makes append-only: kept, never edited or deleted. */
  appendOnlyTables: z.array(z.string()),
  readAt: IsoDateTimeSchema,
  auditLogId: z.number().int().positive(),
});
export type RetentionOverview = z.infer<typeof RetentionOverviewSchema>;
