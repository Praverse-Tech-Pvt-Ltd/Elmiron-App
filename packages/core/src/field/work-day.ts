import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * `BE-W190` / `BE-W191` — the rep's WORKING DAY, as a server record (`20261013000310_work_days`).
 *
 * One row per rep per territory-date. Opened by the rep's first check-in of the date or an explicit
 * start; ENDED by the rep, with the server's stamp and the server's snapshot of the day's totals;
 * reopened only by the rep's field manager or an admin, with a reason. A closed day refuses new
 * check-ins (45015), and a day with a visit still checked in cannot be closed (45016).
 *
 * The rep's two acts travel through the outbox (`sync_push`, entity `work_day`) so they work with
 * no signal; the record travels back through `sync_pull`, so the phone shows the SERVER's word on
 * whether the day is open or ended.
 */
export const WORK_DAY_RPC = {
  /** Rep. "Start my day". Idempotent; refuses a closed day (45015). */
  openWorkDay: 'open_work_day',
  /** Rep. "End my day". Idempotent; refuses while a visit is checked in (45016). */
  closeWorkDay: 'close_work_day',
  /** Field manager (own team) or admin (own company). Undoes a close, with a reason. */
  reopenWorkDay: 'reopen_work_day',
  /** Field manager or admin. Every visible rep's day on one date, with or without a row. */
  teamWorkDays: 'team_work_days',
} as const;

/** How the day came to be open. `day_end`: the rep ended a day nothing had opened. */
export const WorkDayOpenedViaSchema = z.enum(['check_in', 'start', 'day_end']);
export type WorkDayOpenedVia = z.infer<typeof WorkDayOpenedViaSchema>;

export const WorkDayActionSchema = z.enum(['open', 'close']);
export type WorkDayAction = z.infer<typeof WorkDayActionSchema>;

/**
 * What the phone sends to open or end a day — the `sync_push` payload of a `work_day` item.
 *
 * **`workDate` is the day the screen SHOWED the rep**, which is the territory date from the
 * server's clock (`serverTime` on the pull), never the handset's calendar. The server bounds it
 * (today, or up to seven days back for a phone that was offline). `occurredAt` is the moment the
 * rep pressed — a fact only the phone witnessed, recorded beside the server's own stamp and bounded
 * by the same future-clock rule as a check-in (45013).
 */
export const WorkDayRequestSchema = z.object({
  /** Device-generated: the idempotency key. */
  id: UuidSchema,
  action: WorkDayActionSchema,
  workDate: IsoDateSchema,
  occurredAt: IsoDateTimeSchema,
  /** A closing note, optional, only on `close`. */
  note: z.string().trim().max(1000).nullable().optional(),
});
export type WorkDayRequest = z.infer<typeof WorkDayRequestSchema>;

/** The day, as the app reads it. Every stamp and every total is the SERVER's. */
export const WorkDaySchema = z.object({
  id: UuidSchema,
  mrId: UuidSchema,
  workDate: IsoDateSchema,
  timeZone: z.string().min(1),
  openedAt: IsoDateTimeSchema,
  openedVia: WorkDayOpenedViaSchema,
  /** The phone's instant for the act that opened it, beside `openedAt` — never instead of it. */
  clientOpenedAt: IsoDateTimeSchema.nullable(),
  /** Null while the day is open. */
  closedAt: IsoDateTimeSchema.nullable(),
  closeRequestId: UuidSchema.nullable(),
  clientClosedAt: IsoDateTimeSchema.nullable(),
  closingNote: z.string().nullable(),
  /** The snapshot taken when the day closed; null while it is open. */
  totals: z
    .object({
      visitsTotal: z.number().int().nonnegative(),
      visitsCompleted: z.number().int().nonnegative(),
      visitsNotMet: z.number().int().nonnegative(),
      visitsMissed: z.number().int().nonnegative(),
      visitsUnplanned: z.number().int().nonnegative(),
      checkInCount: z.number().int().nonnegative(),
      distanceMetres: z.number().nonnegative(),
      samplesQuantity: z.number().int().nonnegative(),
      inputsQuantity: z.number().int().nonnegative(),
    })
    .nullable(),
  reopenCount: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema,
});
export type WorkDay = z.infer<typeof WorkDaySchema>;

/** A `work_days` row as `to_jsonb` sends it, on the pull and from the RPCs. */
export const WorkDayRowSchema = z.object({
  id: UuidSchema,
  organisation_id: UuidSchema,
  mr_id: UuidSchema,
  territory_id: UuidSchema.nullable(),
  work_date: IsoDateSchema,
  time_zone: z.string().min(1),
  opened_at: IsoDateTimeSchema,
  opened_via: WorkDayOpenedViaSchema,
  client_opened_at: IsoDateTimeSchema.nullable(),
  open_request_id: UuidSchema.nullable(),
  closed_at: IsoDateTimeSchema.nullable(),
  close_request_id: UuidSchema.nullable(),
  client_closed_at: IsoDateTimeSchema.nullable(),
  closing_note: z.string().nullable(),
  visits_total: z.number().int().nonnegative().nullable(),
  visits_completed: z.number().int().nonnegative().nullable(),
  visits_not_met: z.number().int().nonnegative().nullable(),
  visits_missed: z.number().int().nonnegative().nullable(),
  visits_unplanned: z.number().int().nonnegative().nullable(),
  check_in_count: z.number().int().nonnegative().nullable(),
  distance_metres: z.number().nonnegative().nullable(),
  samples_quantity: z.number().int().nonnegative().nullable(),
  inputs_quantity: z.number().int().nonnegative().nullable(),
  reopen_count: z.number().int().nonnegative(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type WorkDayRow = z.infer<typeof WorkDayRowSchema>;

/**
 * Row to contract. **The snapshot is all or nothing**, as the table's `work_days_close_is_whole`
 * constraint makes it: a closed day carries every total, an open one none. A row that breaks that
 * is refused here rather than rendered with some figures missing.
 */
export const fromWorkDayRow = (row: unknown): WorkDay => {
  const parsed = WorkDayRowSchema.parse(row);
  const closed = parsed.closed_at !== null;
  const totals =
    closed &&
    parsed.visits_total !== null &&
    parsed.visits_completed !== null &&
    parsed.visits_not_met !== null &&
    parsed.visits_missed !== null &&
    parsed.visits_unplanned !== null &&
    parsed.check_in_count !== null &&
    parsed.distance_metres !== null &&
    parsed.samples_quantity !== null &&
    parsed.inputs_quantity !== null
      ? {
          visitsTotal: parsed.visits_total,
          visitsCompleted: parsed.visits_completed,
          visitsNotMet: parsed.visits_not_met,
          visitsMissed: parsed.visits_missed,
          visitsUnplanned: parsed.visits_unplanned,
          checkInCount: parsed.check_in_count,
          distanceMetres: parsed.distance_metres,
          samplesQuantity: parsed.samples_quantity,
          inputsQuantity: parsed.inputs_quantity,
        }
      : null;
  if (closed && totals === null) {
    throw new Error(`work day ${parsed.id} is closed and carries no snapshot`);
  }
  return WorkDaySchema.parse({
    id: parsed.id,
    mrId: parsed.mr_id,
    workDate: parsed.work_date,
    timeZone: parsed.time_zone,
    openedAt: parsed.opened_at,
    openedVia: parsed.opened_via,
    clientOpenedAt: parsed.client_opened_at,
    closedAt: parsed.closed_at,
    closeRequestId: parsed.close_request_id,
    clientClosedAt: parsed.client_closed_at,
    closingNote: parsed.closing_note,
    totals,
    reopenCount: parsed.reopen_count,
    updatedAt: parsed.updated_at,
  });
};

/** A day's state on the manager's screen. `not_started`: the rep has no row for that date. */
export const TeamWorkDayStatusSchema = z.enum(['not_started', 'open', 'closed']);
export type TeamWorkDayStatus = z.infer<typeof TeamWorkDayStatusSchema>;

/** One row of `team_work_days(p_on)`, as PostgREST returns it. */
export const TeamWorkDaySchema = z.object({
  mr_id: UuidSchema,
  full_name: z.string(),
  territory_name: z.string().nullable(),
  work_day_id: UuidSchema.nullable(),
  status: TeamWorkDayStatusSchema,
  /** The zone the day was reckoned in; the console shows its stamps in it. Null: no row. */
  time_zone: z.string().nullable(),
  opened_at: IsoDateTimeSchema.nullable(),
  opened_via: WorkDayOpenedViaSchema.nullable(),
  closed_at: IsoDateTimeSchema.nullable(),
  closing_note: z.string().nullable(),
  visits_total: z.number().int().nonnegative().nullable(),
  visits_completed: z.number().int().nonnegative().nullable(),
  visits_not_met: z.number().int().nonnegative().nullable(),
  visits_missed: z.number().int().nonnegative().nullable(),
  distance_metres: z.number().nonnegative().nullable(),
  samples_quantity: z.number().int().nonnegative().nullable(),
  reopen_count: z.number().int().nonnegative(),
});
export type TeamWorkDay = z.infer<typeof TeamWorkDaySchema>;
