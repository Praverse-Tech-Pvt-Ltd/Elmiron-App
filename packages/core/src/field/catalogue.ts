import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * The catalogue — AI-B1, `20260924000400_catalogue.sql`.
 *
 * Read directly by every signed-in user of an organisation (PostgREST table reads, snake_case on
 * the wire; these are the camelCase entity shapes a client maps them to). Written only by an
 * admin.
 *
 * **Identity only.** No indication, dose, claim or label text lives here, and none should be
 * added: that content has a version, an approver and a market, and belongs in approved knowledge.
 * A product row that says something about a drug would be the one unversioned, unapproved
 * statement in the system.
 */

/** ISO 3166-1 alpha-2, upper case. "Global" is not a market: global content names no market. */
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

export const MarketSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  countryCode: CountryCodeSchema,
  name: z.string().min(1),
  isActive: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Market = z.infer<typeof MarketSchema>;

export const TherapyAreaSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  name: z.string().min(1),
  isActive: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type TherapyArea = z.infer<typeof TherapyAreaSchema>;

export const ProductSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  therapyAreaId: UuidSchema.nullable(),
  brandName: z.string().min(1),
  /** The non-proprietary name. Null for a device or kit that has none. */
  genericName: z.string().min(1).nullable(),
  /** A product is retired, never deleted: history points at it. */
  isActive: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Product = z.infer<typeof ProductSchema>;

export const ProductMarketSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  productId: UuidSchema,
  marketId: UuidSchema,
  createdAt: IsoDateTimeSchema,
});
export type ProductMarket = z.infer<typeof ProductMarketSchema>;
