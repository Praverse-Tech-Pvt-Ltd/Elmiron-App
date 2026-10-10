'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  PLANNING_RPC,
  PlanSummarySchema,
  ReassignResultSchema,
  UnplannedVisitReviewSchema,
} from '@fieldforce/core';
import type { DayReview, PlannableDoctor, PlannableRep, ReviewVisit } from '@fieldforce/core';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote, Pill, cell, headerCell } from './ui';
import {
  canReassign,
  originLabel,
  planRefusal,
  reassignRefusal,
  statusLabel,
} from './planning-text';

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

const field = (): CSSProperties => ({
  padding: tokens.space.sm,
  border: `1px solid ${tokens.color.textPrimary}`,
  borderRadius: tokens.radius.control,
  fontSize: compactTypography.body.size,
  fontFamily: 'inherit',
});

const button = (primary = false): CSSProperties => ({
  minHeight: primary ? 52 : 36,
  padding: `0 ${String(tokens.space.md)}px`,
  background: tokens.color.surface,
  border: `${primary ? '2' : '1'}px solid ${tokens.color.textPrimary}`,
  borderRadius: tokens.radius.control,
  color: tokens.color.textPrimary,
  fontSize: compactTypography.control.size,
  fontWeight: Number(compactTypography.control.weight),
  cursor: 'pointer',
});

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
        <form
          method="get"
          action="/planning"
          style={{ display: 'flex', gap: tokens.space.sm, alignItems: 'end', flexWrap: 'wrap' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
            <Label>Rep</Label>
            <select aria-label="Rep" name="rep" defaultValue={rep.mr_id} style={field()}>
              {reps.map((r) => (
                <option key={r.mr_id} value={r.mr_id}>
                  {r.full_name} — {r.territory_name}
                  {r.via_grant ? ' (granted to you)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
            <Label>Day</Label>
            <input aria-label="Day" name="date" type="date" defaultValue={day} style={field()} />
          </div>
          <button type="submit" style={button()}>
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
        <ol
          style={{
            margin: 0,
            paddingLeft: tokens.space.lg,
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space.sm,
          }}
        >
          {stops.map((stop, index) => {
            const clinics = doctorById.get(stop.doctorId)?.clinics ?? [];
            return (
              <li key={stop.doctorId}>
                <div
                  style={{
                    display: 'flex',
                    gap: tokens.space.sm,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ minWidth: 220 }}>{nameOf(stop.doctorId)}</span>
                  <select
                    aria-label={`Clinic for ${nameOf(stop.doctorId)}`}
                    style={field()}
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
                    style={button()}
                    disabled={ended || index === 0}
                    onClick={() => {
                      move(index, -1);
                    }}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    style={button()}
                    disabled={ended || index === stops.length - 1}
                    onClick={() => {
                      move(index, 1);
                    }}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    style={button()}
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

        <div
          style={{ display: 'flex', gap: tokens.space.sm, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <select
            aria-label="Doctor to add"
            style={field()}
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
            style={button()}
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
          style={button(true)}
          disabled={ended || saved.kind === 'busy'}
          onClick={save}
        >
          {saved.kind === 'busy' ? 'Saving…' : 'Save plan'}
        </button>
      </Card>

      <Heading>Visits on {day}</Heading>
      {review.visits.length === 0 ? (
        <Body muted>No visits on this day.</Body>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={headerCell}>Doctor</th>
              <th style={headerCell}>Kind</th>
              <th style={headerCell}>Status</th>
              <th style={headerCell}>Note</th>
              <th style={headerCell}>Action</th>
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
      <td style={cell}>{visit.doctorName}</td>
      <td style={cell}>
        <Pill tone={visit.origin === 'unplanned' ? 'attention' : 'neutral'}>
          {originLabel(visit.origin)}
        </Pill>
      </td>
      <td style={cell}>{statusLabel(visit.status)}</td>
      <td style={cell}>{note}</td>
      <td style={cell}>
        {visit.origin === 'unplanned' ? (
          visit.reviewedByMe ? (
            <Pill tone="success">Reviewed</Pill>
          ) : (
            <button
              type="button"
              style={button()}
              disabled={outcome.kind === 'busy'}
              onClick={markReviewed}
            >
              Mark reviewed
            </button>
          )
        ) : null}
        {canReassign(visit, visit.plannedDate, repToday) && others.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
            <select
              aria-label={`Move ${visit.doctorName} to`}
              style={field()}
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
              style={field()}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <button
              type="button"
              style={button()}
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
