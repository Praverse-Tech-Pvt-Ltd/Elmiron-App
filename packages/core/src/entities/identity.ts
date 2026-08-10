import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../primitives.js';

/**
 * The app has exactly three roles. There is no patient role and no doctor role —
 * doctors do not hold accounts, they consent on the MR's device.
 */
export const RoleSchema = z.enum(['mr', 'field_manager', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const ROLES = RoleSchema.options;

export const TerritorySchema = z.object({
  id: UuidSchema,
  name: z.string().min(1),
  /** Short human-readable identifier, unique across the org, e.g. `MH-PUNE-01`. */
  code: z.string().min(1),
  /** Self-referencing hierarchy. `null` at the root. */
  parentId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Territory = z.infer<typeof TerritorySchema>;

export const UserProfileSchema = z.object({
  /** Same id as the Supabase `auth.users` row. */
  id: UuidSchema,
  fullName: z.string().min(1),
  email: z.email(),
  role: RoleSchema,
  /** An MR and a field manager always have one. An admin may have none. */
  territoryId: UuidSchema.nullable(),
  /** The user this person reports to. `null` at the top of the chain. */
  reportingManagerId: UuidSchema.nullable(),
  isActive: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type UserProfile = z.infer<typeof UserProfileSchema>;
