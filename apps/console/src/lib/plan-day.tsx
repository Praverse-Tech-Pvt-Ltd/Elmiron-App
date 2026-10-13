'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  PLANNING_RPC,
  PlanSummarySchema,
  ReassignResultSchema,
  UnplannedVisitReviewSchema,
} from '@fieldforce/core';
import type { DayReview, PlannableDoctor, PlannableRep, ReviewVisit } from '@fieldforce/core';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote, Pill } from './ui';
import {
  canReassign,
  originLabel,
  planRefusal,
  reassignRefusal,
  statusLabel,
} from './planning-text';
import { btn } from './theme-css';

/**
 * `BE-W171` — the client half of `/planning`. Every write is an RPC; this file holds only the
 * manager's draft of the route and the request id that makes a retried save harmless.
 *
 * **The request id.** A new one is minted whenever the route changes, and reused while it does not:
 * a manager who presses Save twice, or whose first press timed out, sends the SAME id, and
 * `plan_mr_day` answers with the first save instead of writing a second version.
 */

interface Stop {
  readonly doctorId: string;
  readonly clinicAddressId: string | null;
}

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

const newRequestId = (): string => crypto.randomUUID();

const say = (outcome: Outcome): ReactNode =>
  outcome.kind === 'done' ? (
    <Body>{outcome.message}</Body>
  ) : outcome.kind === 'refused' ? (
    <MissingNote>{outcome.message}</MissingNote>
  ) : null;

export const PlanDay = ({
  day,
  rep,
  reps,
  doctors,
  review,
}: {
  readonly day: string;
  readonly rep: PlannableRep;
  readonly reps: readonly PlannableRep[];
  readonly doctors: readonly PlannableDoctor[];
  readonly review: DayReview;
}): ReactNode => {
  const router = useRouter();
  const current = review.plans.find((p) => p.planDate === day) ?? null;
  const [stops, setStops] = useState<readonly Stop[]>(
    (current?.entries ?? []).map((e) => ({
      doctorId: e.doctorId,
      clinicAddressId: e.clinicAddressId,
    })),
  );
  const [requestId, setRequestId] = useState(newRequestId);
  const [adding, setAdding] = useState('');
  const [saved, setSaved] = useState<Outcome>({ kind: 'idle' });

  const doctorById = new Map(doctors.map((d) => [d.doctor_id, d]));
  const nameOf = (doctorId: string): string =>
    doctorById.get(doctorId)?.full_name ??
    current?.entries.find((e) => e.doctorId === doctorId)?.doctorName ??
    'A doctor no longer in this territory';
  const available = doctors.filter((d) => !stops.some((s) => s.doctorId === d.doctor_id));
  const ended = day < review.today;

  const edit = (next: readonly Stop[]): void => {
    setStops(next);
    setRequestId(newRequestId());
    setSaved({ kind: 'idle' });
  };
  const move = (index: number, by: -1 | 1): void => {
    const next = [...stops];
    const [taken] = next.splice(index, 1);
    if (taken === undefined) return;
    next.splice(index + by, 0, taken);
    edit(next);
  };

  const save = (): void => {
    setSaved({ kind: 'busy' });
    void browserClient()
      .rpc(PLANNING_RPC.planMrDay, {
        p_mr_id: rep.mr_id,
        p_plan_date: day,
        p_entries: stops,
        p_request_id: requestId,
      })
      .then(({ data, error }) => {
        if (error !== null) {
          setSaved({ kind: 'refused', message: planRefusal(error) });
          return;
        }
        const summary = PlanSummarySchema.parse(data);
        setSaved({
          kind: 'done',
          message: summary.unchanged
            ? 'No change — this is already the plan. Nothing new was written.'
            : summary.replayed
              ? `Already saved as version ${String(summary.version)}.`
              : `Saved as version ${String(summary.version)}: ${String(summary.visitsCreated ?? 0)} visit(s) added, ` +
                `${String(summary.visitsMoved ?? 0)} kept on the new version, ${String(summary.visitsCancelled ?? 0)} cancelled.`,
        });
        router.refresh();
      });
  };

  return (
    <>
      <Card>
        <form method="get" action="/planning" className="ff-filters">
          <div className="ff-cell-stack">
            <Label>Rep</Label>
            <select aria-label="Rep" name="rep" defaultValue={rep.mr_id}>
              {reps.map((r) => (
                <option key={r.mr_id} value={r.mr_id}>
                  {r.full_name} — {r.territory_name}
                  {r.via_grant ? ' (granted to you)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="ff-cell-stack">
            <Label>Day</Label>
            <input aria-label="Day" name="date" type="date" defaultValue={day} />
          </div>
          <button type="submit" className={btn('secondary')}>
            Show
          </button>
        </form>
        <Body muted>
          {review.fullName}’s today is {review.today}.
          {rep.via_grant ? ' You plan for this rep under an admin’s grant for this day.' : ''}
        </Body>
      </Card>

      <Card>
        <Heading>
          Route for {day}
          {current === null ? ' — no plan yet' : ` — version ${String(current.version)}`}
        </Heading>
        {ended ? (
          <MissingNote>
            This day has ended for the rep. Its plan is history and cannot be changed.
          </MissingNote>
        ) : null}
        {stops.length === 0 ? <Body muted>No stops. Add a doctor below.</Body> : null}
        {/* `role="list"`: a list drawn without bullets loses its list semantics in Safari. */}
        <ol className="ff-route" role="list">
          {stops.map((stop, index) => {
            const clinics = doctorById.get(stop.doctorId)?.clinics ?? [];
            return (
              <li key={stop.doctorId}>
                <div className="ff-route-stop">
                  <span className="ff-route-name">{nameOf(stop.doctorId)}</span>
                  <select
                    aria-label={`Clinic for ${nameOf(stop.doctorId)}`}
                    value={stop.clinicAddressId ?? ''}
                    disabled={ended}
                    onChange={(e) => {
                      edit(
                        stops.map((s, i) =>
                          i === index
                            ? {
                                ...s,
                                clinicAddressId: e.target.value === '' ? null : e.target.value,
                              }
                            : s,
                        ),
                      );
                    }}
                  >
                    <option value="">No clinic chosen</option>
                    {clinics.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}, {c.city}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={btn('secondary')}
                    disabled={ended || index === 0}
                    onClick={() => {
                      move(index, -1);
                    }}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className={btn('secondary')}
                    disabled={ended || index === stops.length - 1}
                    onClick={() => {
                      move(index, 1);
                    }}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className={btn('danger')}
                    disabled={ended}
                    onClick={() => {
                      edit(stops.filter((_, i) => i !== index));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="ff-row">
          <select
            aria-label="Doctor to add"
            value={adding}
            disabled={ended || available.length === 0}
            onChange={(e) => {
              setAdding(e.target.value);
            }}
          >
            <option value="">
              {available.length === 0 ? 'Every doctor is on the plan' : 'Choose a doctor'}
            </option>
            {available.map((d) => (
              <option key={d.doctor_id} value={d.doctor_id}>
                {d.full_name}
                {d.specialty === null ? '' : ` — ${d.specialty}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btn('secondary')}
            disabled={ended || adding === ''}
            onClick={() => {
              const doctor = doctorById.get(adding);
              edit([
                ...stops,
                { doctorId: adding, clinicAddressId: doctor?.clinics[0]?.id ?? null },
              ]);
              setAdding('');
            }}
          >
            Add to route
          </button>
        </div>

        {say(saved)}
        <button
          type="button"
          className={btn('primary')}
          disabled={ended || saved.kind === 'busy'}
          onClick={save}
        >
          {saved.kind === 'busy' ? 'Saving…' : 'Save plan'}
        </button>
      </Card>

      <Card>
        <Heading>Visits on {day}</Heading>
        {review.visits.length === 0 ? (
          <Body muted>No visits on this day.</Body>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Doctor</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Note</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {review.visits.map((visit) => (
                <VisitRow
                  key={visit.visitId}
                  visit={visit}
                  reps={reps}
                  rep={rep}
                  repToday={review.today}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
};

const VisitRow = ({
  visit,
  reps,
  rep,
  repToday,
}: {
  readonly visit: ReviewVisit;
  readonly reps: readonly PlannableRep[];
  readonly rep: PlannableRep;
  readonly repToday: string;
}): ReactNode => {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [requestId] = useState(newRequestId);
  const others = reps.filter((r) => r.mr_id !== rep.mr_id);
  const nameOfRep = (id: string | null): string =>
    reps.find((r) => r.mr_id === id)?.full_name ?? 'another rep';

  const markReviewed = (): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(PLANNING_RPC.reviewUnplannedVisit, { p_visit_id: visit.visitId, p_note: null })
      .then(({ data, error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: planRefusal(error) });
          return;
        }
        UnplannedVisitReviewSchema.parse(data);
        router.refresh();
      });
  };

  const reassign = (): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(PLANNING_RPC.reassignPlannedVisits, {
        p_visit_ids: [visit.visitId],
        p_to_mr_id: target,
        p_reason: reason,
        p_request_id: requestId,
      })
      .then(({ data, error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: reassignRefusal(error) });
          return;
        }
        ReassignResultSchema.parse(data);
        setOutcome({ kind: 'done', message: `Moved to ${nameOfRep(target)}.` });
        router.refresh();
      });
  };

  const note =
    visit.origin === 'unplanned'
      ? `Reason: ${visit.unplannedReason ?? ''}`
      : visit.reassignedTo !== null
        ? `Moved to ${nameOfRep(visit.reassignedTo)}`
        : visit.notMetReason !== null
          ? `Not met: ${visit.notMetReason}`
          : '';

  return (
    <tr>
      <td>{visit.doctorName}</td>
      <td>
        <Pill tone={visit.origin === 'unplanned' ? 'attention' : 'neutral'}>
          {originLabel(visit.origin)}
        </Pill>
      </td>
      <td>{statusLabel(visit.status)}</td>
      <td>{note}</td>
      <td>
        {visit.origin === 'unplanned' ? (
          visit.reviewedByMe ? (
            <Pill tone="success">Reviewed</Pill>
          ) : (
            <button
              type="button"
              className={btn('secondary')}
              disabled={outcome.kind === 'busy'}
              onClick={markReviewed}
            >
              Mark reviewed
            </button>
          )
        ) : null}
        {canReassign(visit, visit.plannedDate, repToday) && others.length > 0 ? (
          <div className="ff-cell-stack">
            <select
              aria-label={`Move ${visit.doctorName} to`}
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
              }}
            >
              <option value="">Move to…</option>
              {others.map((r) => (
                <option key={r.mr_id} value={r.mr_id}>
                  {r.full_name}
                </option>
              ))}
            </select>
            <input
              aria-label="Why it moves"
              placeholder="Why it moves"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <button
              type="button"
              className={btn('secondary')}
              disabled={target === '' || outcome.kind === 'busy'}
              onClick={reassign}
            >
              Move visit
            </button>
          </div>
        ) : null}
        {say(outcome)}
      </td>
    </tr>
  );
};
