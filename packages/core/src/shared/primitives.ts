import { z } from 'zod';

/**
 * Wire format conventions for every schema in this package:
 * - Field names are camelCase. Postgres columns are snake_case; the mapping happens
 *   at the API edge, never in the client.
 * - Timestamps are ISO 8601 strings with an explicit offset. Never epoch numbers.
 * - Calendar dates with no time component are `YYYY-MM-DD` strings.
 * - Money and distances carry their unit in the field name.
 */

export const UuidSchema = z.uuid();
export type Uuid = z.infer<typeof UuidSchema>;

/** ISO 8601 instant with an explicit UTC offset, e.g. `2026-08-10T09:15:00+05:30`. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** Calendar date, `YYYY-MM-DD`. Used for beat-plan dates and effective dates. */
export const IsoDateSchema = z.iso.date();
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** BCP-47 language tag, e.g. `en-IN`, `hi-IN`. */
export const LanguageTagSchema = z.string().min(2).max(35);
export type LanguageTag = z.infer<typeof LanguageTagSchema>;

export const CoordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMetres: z.number().nonnegative().nullable(),
  capturedAt: IsoDateTimeSchema,
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;
