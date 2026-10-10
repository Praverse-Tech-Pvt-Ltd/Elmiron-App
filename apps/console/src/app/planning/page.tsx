import type { ReactNode } from 'react';
import {
  DayReviewSchema,
  PLANNING_RPC,
  PlannableDoctorSchema,
  PlannableRepSchema,
} from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { signedIn } from '../../lib/session';
import { Body, MissingNote, Title } from '../../lib/ui';
import { PlanDay } from '../../lib/plan-day';
import { planRefusal } from '../../lib/planning-text';

/**
 * `BE-W171` / `BE-C78` — the manager plans a rep's day (Q-17: on the web console).
 *
 * **Nothing here decides who may plan.** `plannable_reps` lists the reps this manager may plan on
 * the chosen day — their own territory subtree, plus any territory an admin has granted them for it
 * — and every read and write after that is an RPC that checks again. An admin who opens this page is
 * refused by the first call, and the page says so in words.
 */
export const dynamic = 'force-dynamic';

const isDate = (value: string | undefined): value is string =>
  value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value);

export default async function Planning({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly rep?: string; readonly date?: string }>;
}): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const params = await searchParams;
  // The default day is the server's date; the rep's own today, in their territory's zone, is shown
  // beside it once a rep is chosen, and it is the day the database refuses to plan before.
  const day = isDate(params.date) ? params.date : new Date().toISOString().slice(0, 10);

  const repsResult = await session.db.rpc(PLANNING_RPC.plannableReps, { p_on: day });
  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
      <Title>Plan a rep’s day</Title>
      <Body muted>
        Choose a rep and a day, put the doctors in route order, and save. Each save is a new version
        of the plan; visits already started or finished are never changed. A visit a rep made
        without a plan appears below as unplanned, for you to review.
      </Body>
    </div>
  );

  if (repsResult.error !== null) {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1000 }}
      >
        {header}
        <MissingNote tone="critical">{planRefusal(repsResult.error)}</MissingNote>
      </div>
    );
  }

  const reps = ((repsResult.data ?? []) as unknown[]).map((row) => PlannableRepSchema.parse(row));
  if (reps.length === 0) {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1000 }}
      >
        {header}
        <MissingNote>
          There is no rep you may plan on {day}: nobody in your territory, and no territory granted
          to you for that day.
        </MissingNote>
      </div>
    );
  }

  const selected = reps.find((r) => r.mr_id === params.rep) ?? reps[0];
  if (selected === undefined) return header;

  const [doctorsResult, reviewResult] = await Promise.all([
    session.db.rpc(PLANNING_RPC.plannableDoctors, { p_mr_id: selected.mr_id, p_on: day }),
    session.db.rpc(PLANNING_RPC.managerDayReview, {
      p_mr_id: selected.mr_id,
      p_from: day,
      p_to: day,
    }),
  ]);
  const refusal = doctorsResult.error ?? reviewResult.error;
  if (refusal !== null) {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1000 }}
      >
        {header}
        <MissingNote>{planRefusal(refusal)}</MissingNote>
      </div>
    );
  }

  const doctors = ((doctorsResult.data ?? []) as unknown[]).map((row) =>
    PlannableDoctorSchema.parse(row),
  );
  const review = DayReviewSchema.parse(reviewResult.data);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1000 }}>
      {header}
      <PlanDay day={day} doctors={doctors} rep={selected} reps={reps} review={review} />
    </div>
  );
}
