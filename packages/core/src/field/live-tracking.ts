import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * `BE-W180` — live tracking (`20261013000100_live_tracking`).
 *
 * A rep's position every few minutes, kept only while the company has switched it on, the rep has
 * accepted the CURRENT notice, and the position was taken and received inside the rep's working
 * hours — every one of those re-checked by `record_location_ping` on every call. Every write is one
 * of these RPCs; there is no table write. The schemas below parse exactly what each RPC returns, so
 * the phone, the console and the tests read one shape.
 */
export const LIVE_TRACKING_RPC = {
  /** Rep. Everything the phone needs to decide whether it may track, all of it the server's. */
  myLiveTracking: 'my_live_tracking',
  /** Rep. Accept the notice version that was READ; refused `45001` if it is no longer current. */
  acceptNotice: 'accept_live_tracking_notice',
  /** Rep. Withdraw; the next position is refused at once. */
  withdraw: 'withdraw_live_tracking',
  /** Rep. The only write path for a position. Answers a verdict rather than raising. */
  recordPing: 'record_location_ping',
  /** Field manager or admin. Every visible rep and their latest position. */
  overview: 'live_tracking_overview',
  /** Rep (own), field manager or admin. One rep's positions on one territory day. */
  trail: 'live_tracking_trail',
  /** Admin. The company switch, with a reason; an audited `app_thresholds` row. */
  setEnabled: 'set_live_tracking_enabled',
  /** Admin. Load the company's own notice text; nobody sees it until a second admin approves. */
  proposeNotice: 'propose_live_tracking_notice',
  /** Admin, not the author. Approves a loaded notice; the company's reps must then accept it again. */
  approveNotice: 'approve_live_tracking_notice',
} as const;

/**
 * The notice a rep must accept. `isDraft`: the engineering draft, shown labelled as one, because the
 * company has not loaded and approved its own text.
 */
export const LiveTrackingNoticeSchema = z.object({
  id: UuidSchema,
  versionLabel: z.string(),
  body: z.string(),
  isDraft: z.boolean(),
});
export type LiveTrackingNotice = z.infer<typeof LiveTrackingNoticeSchema>;

/** What `my_live_tracking`, `accept_live_tracking_notice` and `withdraw_live_tracking` answer. */
export const LiveTrackingStatusSchema = z.object({
  companyEnabled: z.boolean(),
  /** Seconds between positions; the company's setting, held between 60 and 3600. */
  intervalSeconds: z.number().int().min(60).max(3600),
  notice: LiveTrackingNoticeSchema.nullable(),
  /** The rep has accepted THIS notice and not withdrawn. */
  accepted: z.boolean(),
  /** The version the rep's standing acceptance is of — an OLDER one when the notice has changed. */
  acceptedNoticeVersionId: UuidSchema.nullable(),
  /** Now is inside the rep's working hours, by the server's window and clock. */
  withinWorkingHours: z.boolean(),
  /** `HH:MM:SS`, the end of the working hours, or null when none is configured. */
  shiftEnd: z.string().nullable(),
  timeZone: z.string().nullable(),
  /** The rep's territory date, from the server's clock. */
  today: IsoDateSchema,
  serverTime: IsoDateTimeSchema,
});
export type LiveTrackingStatus = z.infer<typeof LiveTrackingStatusSchema>;

/** Why a position was not kept. The phone stops on the first two and pauses on the third. */
export const PingRefusalSchema = z.enum([
  'company_off',
  'no_acceptance',
  'outside_working_hours',
  'recorded_in_future',
  'too_old',
  'implausible_accuracy',
  'too_frequent',
]);
export type PingRefusal = z.infer<typeof PingRefusalSchema>;

/** What `record_location_ping` answers. `replayed`: the same id was already kept. */
export const PingVerdictSchema = z.object({
  stored: z.boolean(),
  replayed: z.boolean(),
  reason: PingRefusalSchema.nullable(),
  receivedAt: IsoDateTimeSchema.nullable(),
});
export type PingVerdict = z.infer<typeof PingVerdictSchema>;

export const TrackedPositionSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracyM: z.number().nullable(),
  /** The DEVICE's time, bounded by the server but not trusted. */
  recordedAt: IsoDateTimeSchema,
  /** The server's time. */
  receivedAt: IsoDateTimeSchema,
});
export type TrackedPosition = z.infer<typeof TrackedPositionSchema>;

export const TeamRepSchema = z.object({
  mrId: UuidSchema,
  fullName: z.string(),
  territoryName: z.string().nullable(),
  accepted: z.boolean(),
  today: IsoDateSchema,
  /** The rep's territory zone (`UTC` when none is configured), for showing the rep's own clock. */
  timeZone: z.string(),
  pingsToday: z.number().int().nonnegative(),
  /** The newest position, with its age in seconds by the server's clock, or null. */
  latest: TrackedPositionSchema.extend({ ageSeconds: z.number().int().nonnegative() }).nullable(),
});
export type TeamRep = z.infer<typeof TeamRepSchema>;

/** What `live_tracking_overview` answers. */
export const TrackingOverviewSchema = z.object({
  companyEnabled: z.boolean(),
  intervalSeconds: z.number().int(),
  /** Only an admin changes the switch. */
  canChangeSwitch: z.boolean(),
  notice: z.object({ id: UuidSchema, versionLabel: z.string(), isDraft: z.boolean() }).nullable(),
  serverTime: IsoDateTimeSchema,
  reps: z.array(TeamRepSchema),
});
export type TrackingOverview = z.infer<typeof TrackingOverviewSchema>;

/** What `live_tracking_trail` answers: positions oldest first. */
export const TrackingTrailSchema = z.object({
  mrId: UuidSchema,
  fullName: z.string(),
  day: IsoDateSchema,
  timeZone: z.string(),
  points: z.array(TrackedPositionSchema.extend({ id: UuidSchema })),
});
export type TrackingTrail = z.infer<typeof TrackingTrailSchema>;

/** What `set_live_tracking_enabled` answers: the switch as it now resolves. */
export const TrackingSwitchResultSchema = z.object({
  enabled: z.boolean(),
  setAt: IsoDateTimeSchema,
});
export type TrackingSwitchResult = z.infer<typeof TrackingSwitchResultSchema>;

/** A position on Google Maps. Needs no key; the coordinates are the only thing in the URL. */
export const googleMapsUrl = (latitude: number, longitude: number): string =>
  `https://www.google.com/maps?q=${String(latitude)},${String(longitude)}`;
