import { randomUUID } from 'node:crypto';
import {
  CreateCallReportRequestSchema,
  CreateCheckInRequestSchema,
  CreateCheckOutRequestSchema,
  CreateConsentRecordRequestSchema,
  CreateSampleAndInputRequestSchema,
} from '@fieldforce/core';
import type {
  CreateCallReportRequest,
  CreateCheckInRequest,
  CreateCheckOutRequest,
  CreateConsentRecordRequest,
  CreateSampleAndInputRequest,
} from '@fieldforce/core';

/**
 * Sync items built from the CONTRACT, not from what the SQL happens to read — MR-25 Part B.
 *
 * **Why this file exists.** `gate1.spec.ts` opens by saying it simulates "one MR's day entirely
 * through the sync path — the same path a real device uses". It built its items by hand:
 *
 * ```ts
 * payload: { visitId, latitude: stop.lat, longitude: stop.lon, occurredAt: visitStart }
 * ```
 *
 * The body the app sends is `{ id, visitId, source, occurredAt, coordinates: { … } }`. Flat
 * versus nested, and no `id`. `apply_sync_item` read the flat shape, so **the test and the
 * function agreed with each other and neither agreed with the product** — and the suite was
 * green while check-in had never once worked end to end from a real client.
 *
 * MR-24 corrected the literals. That fixed the instances and not the class: the next person to
 * add a case can still type an object that satisfies the SQL, because `type Item =
 * Record<string, unknown>` cannot object.
 *
 * **What closes the class.** Every body below is annotated with its contract type AND parsed
 * through its schema. The annotation makes a shape change a COMPILE error in this file; the
 * parse makes it a RUN-TIME failure with a field-level message even where a literal is widened
 * to `Record<string, unknown>` on its way into `JSON.stringify`. Belt and braces on purpose —
 * the whole defect was a shape crossing a boundary that erased its type, and the parse is the
 * half that survives the erasure.
 *
 * **The builders live in `apps/field`, not here.** `checkInRequest()` and friends are client
 * code; a server test importing them would invert the dependency. The SCHEMA is the shared
 * artefact — `services/api` already depends on `@fieldforce/core` — so the schema is what these
 * bind to. That is the strongest available parity short of running the client, and it is named
 * rather than glossed: **this proves the body matches the CONTRACT, not that the client
 * produces it.** `apps/field/src/sync/push-client.test.ts` is what proves the second half, and
 * it is already typed against the same contract.
 */

/** What `sync_push` takes for one item. `payload` is deliberately the contract type. */
// A TYPE, not an interface, on purpose: an interface has no implicit index signature, so it
// cannot be assigned to the `Record<string, unknown>` array that `sync_push` callers build
// from mixed entities. The alias keeps these usable alongside hand-built `visit` items
// without a cast at every call site -- and a cast at every call site is how the typing gets
// quietly abandoned.
export type SyncItem<TPayload> = {
  readonly id: string;
  readonly entity: string;
  readonly operation: string;
  readonly entityId: string;
  readonly clientCreatedAt: string;
  readonly payload: TPayload;
};

/**
 * `entityId` is the VISIT, exactly as `push-client.ts` sends it and for the reason it states —
 * items waiting on one visit group together on the queue screen. It is a GROUPING key.
 *
 * The row's identity is `payload.id`. MR-24's defect 7 was these two being conflated: with no
 * `id` in the payload, `apply_sync_item` used `entityId` as each record's primary key, so a
 * doctor's second consent on a visit found the first by id and returned it — a withdrawal
 * discarded and reported as accepted. Keeping both fields visible here, with this comment, is
 * deliberate: a helper that hid the distinction would re-create the defect's conditions.
 */
const item = <T extends { readonly id: string; readonly visitId: string }>(
  entity: string,
  payload: T,
  clientCreatedAt: string,
): SyncItem<T> => ({
  id: randomUUID(),
  entity,
  operation: 'create',
  entityId: payload.visitId,
  clientCreatedAt,
  payload,
});

export interface CoordinateArgs {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMetres?: number | null;
}

export const checkInBody = (args: {
  readonly id?: string;
  readonly visitId: string;
  readonly occurredAt: string;
  readonly coordinates: CoordinateArgs;
  readonly source?: 'automatic' | 'manual';
}): CreateCheckInRequest =>
  CreateCheckInRequestSchema.parse({
    id: args.id ?? randomUUID(),
    visitId: args.visitId,
    coordinates: {
      latitude: args.coordinates.latitude,
      longitude: args.coordinates.longitude,
      accuracyMetres: args.coordinates.accuracyMetres ?? null,
      // The moment the FIX was taken. Equal to `occurredAt` here because a test has no
      // separate fix time; the contract keeps them apart because a real device can.
      capturedAt: args.occurredAt,
    },
    source: args.source ?? 'automatic',
    occurredAt: args.occurredAt,
  } satisfies CreateCheckInRequest);

/**
 * **`CreateCheckOutRequestSchema` IS `CreateCheckInRequestSchema`.**
 *
 * No shape check anywhere can tell a departure from an arrival — MR-08's defect, where a
 * check-out queued offline was replayed as a check-in: a real geo-and-time record, against the
 * right visit, describing the wrong event, with nothing reporting a problem. Only the `entity`
 * tag carries the difference, which is why this function exists separately despite being
 * identical: the call site has to name which one it means.
 */
export const checkOutBody = (args: Parameters<typeof checkInBody>[0]): CreateCheckOutRequest =>
  CreateCheckOutRequestSchema.parse(checkInBody(args) satisfies CreateCheckOutRequest);

export const consentBody = (args: {
  readonly id?: string;
  readonly visitId: string;
  readonly doctorId: string;
  readonly outcome: 'consented' | 'declined' | 'not_asked';
  readonly consentTextVersionId: string;
  readonly displayedLanguage: string;
  readonly capturedAt: string;
  readonly notAskedReason?: string | null;
}): CreateConsentRecordRequest =>
  CreateConsentRecordRequestSchema.parse({
    id: args.id ?? randomUUID(),
    visitId: args.visitId,
    doctorId: args.doctorId,
    outcome: args.outcome,
    notAskedReason: args.notAskedReason ?? null,
    consentTextVersionId: args.consentTextVersionId,
    displayedLanguage: args.displayedLanguage,
    capturedAt: args.capturedAt,
  } satisfies CreateConsentRecordRequest);

export const sampleBody = (args: {
  readonly id?: string;
  readonly visitId: string;
  readonly doctorId: string;
  readonly kind: 'sample' | 'input';
  readonly itemName: string;
  readonly quantity: number;
  readonly declaredValueInr: number;
  readonly occurredAt: string;
}): CreateSampleAndInputRequest =>
  CreateSampleAndInputRequestSchema.parse({
    id: args.id ?? randomUUID(),
    visitId: args.visitId,
    doctorId: args.doctorId,
    kind: args.kind,
    itemName: args.itemName,
    quantity: args.quantity,
    declaredValueInr: args.declaredValueInr,
    occurredAt: args.occurredAt,
  } satisfies CreateSampleAndInputRequest);

export const callReportBody = (args: {
  readonly id?: string;
  readonly visitId: string;
  readonly summary: string;
  readonly productIdsDiscussed?: readonly string[];
  readonly objectionsRaised?: string | null;
  readonly nextStep?: string | null;
}): CreateCallReportRequest =>
  CreateCallReportRequestSchema.parse({
    id: args.id ?? randomUUID(),
    visitId: args.visitId,
    summary: args.summary,
    productIdsDiscussed: [...(args.productIdsDiscussed ?? [])],
    objectionsRaised: args.objectionsRaised ?? null,
    nextStep: args.nextStep ?? null,
  } satisfies CreateCallReportRequest);

export const checkInItem = (
  args: Parameters<typeof checkInBody>[0],
): SyncItem<CreateCheckInRequest> => item('check_in', checkInBody(args), args.occurredAt);

export const checkOutItem = (
  args: Parameters<typeof checkOutBody>[0],
): SyncItem<CreateCheckOutRequest> => item('check_out', checkOutBody(args), args.occurredAt);

export const consentItem = (
  args: Parameters<typeof consentBody>[0],
): SyncItem<CreateConsentRecordRequest> =>
  item('consent_record', consentBody(args), args.capturedAt);

export const sampleItem = (
  args: Parameters<typeof sampleBody>[0],
): SyncItem<CreateSampleAndInputRequest> =>
  item('sample_and_input', sampleBody(args), args.occurredAt);

export const callReportItem = (
  args: Parameters<typeof callReportBody>[0] & { readonly clientCreatedAt: string },
): SyncItem<CreateCallReportRequest> =>
  item('call_report', callReportBody(args), args.clientCreatedAt);
