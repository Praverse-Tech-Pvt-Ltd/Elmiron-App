import type {
  BeatPlanEntry,
  BeatPlanRecord,
  BeatPlanStatus,
  Doctor,
  Visit,
} from '@fieldforce/core';
import { buildDayRoute } from './route';
import type { DayRoute } from './route';

/**
 * `BE-W89`, client half — MR-45 B. What the beat-plan screen shows, decided here so it can be
 * asserted without a renderer and without a network.
 *
 * ### The scope decision, which this module encodes rather than restates
 *
 * The screen renders the plan **with its status shown honestly.** Before MR-45 it kept only
 * plans whose `status === 'approved'` — and nothing in this system ever writes `approved`,
 * because the approval action lives in a manager console that is out of v1. So the filter
 * hid every real plan. **It is not fixed by marking plans approved**: a plan marked approved
 * that no manager approved is a false record. It is fixed by showing every plan for today and
 * saying which state it is in.
 *
 * ### Three ways to be empty, and they must not look alike
 *
 * A plan and its entries are separate rows in one cursor-ordered stream (`beat_plan` and
 * `beat_plan_entry`), so the plan can be on the handset before its stops are. That window is
 * real, and it is the reason this screen was left on the mock for six weeks: the component's
 * only empty state said *"No beat plan came through"*, which is false when a plan DID come
 * through and its stops are still arriving.
 *
 * | View | When | What it claims |
 * | --- | --- | --- |
 * | `no-plan` | the pull has settled and there is no plan for today | there is no plan |
 * | `syncing` | a plan is here, it has no stops yet, and the pull has NOT settled | the stops are on their way |
 * | `no-stops` | a plan is here, it has no stops, and the pull HAS settled | the plan genuinely has none |
 *
 * **"Settled" is the store's `status === 'ready'`, not `entries.length === 0`.** The existing
 * `doctorsPendingAddresses` treats zero as pending, which can never tell "not arrived" from
 * "has none" — a doctor with no addresses reads as syncing forever. Here the difference
 * decides whether the screen tells the MR they have stops or not, so it uses the signal that
 * actually knows.
 *
 * **One known limit of that signal**, recorded rather than hidden: the store sets `ready`
 * when its paging loop ends, and the loop also ends at `MAX_PAGES` with `hasMore` still true.
 * At 200 changes a page that is 10,000 changes in one foreground, so it is not a working-day
 * case — but `ready` means "the loop stopped", which is slightly weaker than "drained".
 */

/**
 * The plan's state, in the MR's words.
 *
 * **`submitted` says what is true and nothing more**: the MR sent it, no manager has decided.
 * The approved wording must never appear for it — `beat-plan-view.test.ts` asserts that
 * absence, not merely the presence of the right sentence, because a line that said both would
 * pass a presence check and still tell the MR their plan was approved.
 */
export const planStatusLine = (status: BeatPlanStatus): string => {
  switch (status) {
    case 'submitted':
      return 'Submitted — not yet approved';
    case 'approved':
      return 'Approved by your manager';
    case 'draft':
      return 'Draft — not submitted yet';
    case 'rejected':
      return 'Not approved — your manager sent it back';
    default: {
      // The same guard the other status switches in this app carry: a new member fails the
      // build naming the member, rather than as a missing return.
      const unhandled: never = status;
      throw new Error(`unhandled beat plan status: ${String(unhandled)}`);
    }
  }
};

/**
 * Today's plan, by the SERVER's date in the territory's zone — never the handset's.
 *
 * `today` is `usePulledStore().today`, which is `territoryToday(serverTime, zone)`. A plan is
 * dated by the territory's calendar, so this is the comparison that has to be right across the
 * 18:30Z boundary, where the UTC date and the IST date differ.
 *
 * **Newest `version` wins.** A changed plan is a new row carrying `supersedesBeatPlanId`, not an
 * edit, so an older version for the same day is a plan the MR must not follow.
 */
export const todaysPlan = (
  plans: readonly BeatPlanRecord[],
  today: string | null,
): BeatPlanRecord | null => {
  if (today === null) return null;
  const candidates = plans.filter((plan) => plan.planDate === today);
  return candidates.slice().sort((a, b) => b.version - a.version)[0] ?? null;
};

export type BeatPlanView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'no-plan' }
  | { readonly kind: 'syncing'; readonly statusLine: string }
  | { readonly kind: 'no-stops'; readonly statusLine: string }
  | { readonly kind: 'route'; readonly statusLine: string; readonly route: DayRoute };

export interface BeatPlanViewInput {
  readonly status: 'loading' | 'ready' | 'failed';
  readonly today: string | null;
  readonly plans: readonly BeatPlanRecord[];
  readonly entries: readonly BeatPlanEntry[];
  readonly visits: readonly Visit[];
  readonly doctors: readonly Doctor[];
}

/**
 * **The visits that belong to THIS plan's day — and only those.**
 *
 * MR-45 B3 found the defect this closes, by checking the rendered values against the server
 * rather than checking that something rendered. `buildDayRoute` matches a visit to a stop by
 * DOCTOR alone. On the mock that was harmless, because the mock only ever served today's
 * visits. The pulled store holds the MR's whole history, so a doctor seen on 16 September
 * rendered as DONE on 21 September's route, and the header counted it — "3 planned · 1 done"
 * on a day nobody had been visited.
 *
 * **MR-47 — `BE-W107`. The day is the SERVER's answer, not a copy of its rule.** MR-45 reckoned
 * it here from `completedAt ?? startedAt ?? scheduledFor` in the territory zone; MR-46 found
 * that was a second copy of `coverage()`'s rule and that the two already differed. The server
 * now decides it once, in `visit_day()`, and sends it on every visit; the manager's report
 * counts by the same function. A visit whose day the server has not sent (`null`: a direct
 * write response, before the next pull) is on no plan's day.
 */
const visitsOnPlanDay = (visits: readonly Visit[], planDate: string): readonly Visit[] =>
  visits.filter((visit) => visit.visitDay === planDate);

export const beatPlanView = (input: BeatPlanViewInput): BeatPlanView => {
  const { status, today } = input;

  // No server date yet: the screen cannot know which plan is today's. A failed pull says so;
  // anything else is still on its way. Neither may claim "no plan".
  if (today === null) return status === 'failed' ? { kind: 'unreachable' } : { kind: 'loading' };

  const plan = todaysPlan(input.plans, today);

  if (plan === null) {
    // "No plan" is a claim about the server, so only a SETTLED pull may make it.
    if (status === 'ready') return { kind: 'no-plan' };
    return status === 'failed' ? { kind: 'unreachable' } : { kind: 'loading' };
  }

  const statusLine = planStatusLine(plan.status);
  const entries = input.entries.filter((entry) => entry.beatPlanId === plan.id);

  if (entries.length === 0) {
    return status === 'ready' ? { kind: 'no-stops', statusLine } : { kind: 'syncing', statusLine };
  }

  // `consents` is empty on purpose, not by omission. The pull does not carry consent RECORDS
  // (MR-12 Q4: ~3,000 audit rows a day for reinstall-only value), so a stop's consent is
  // unknown here — and `consentLabel(null)` renders nothing rather than "no consent". The
  // mock-backed screen showed consent per stop; this one honestly cannot.
  return {
    kind: 'route',
    statusLine,
    route: buildDayRoute(
      { ...plan, entries },
      visitsOnPlanDay(input.visits, plan.planDate),
      input.doctors,
      [],
    ),
  };
};

/**
 * `BE-W89`'s last piece — MR-46 D1. The doctors the Doctors screen's "On plan" chip keeps.
 *
 * **Derived from `beatPlanView`, not from a second reading of the store**, so the chip and the
 * Beat plan screen cannot disagree about which plan is today's, or about whether it has arrived.
 *
 * `null` means **do not offer the chip**: the pull has not settled (`loading`, `syncing`), it
 * failed (`unreachable`), or there is no plan today (`no-plan`). An empty set filtered against
 * a plan that has not arrived would show "No doctors under On plan" — the client presenting its
 * own gap as a fact about the day.
 *
 * `no-stops` is different: the plan is here, settled, and has none. An empty set is then true.
 *
 * Plan status is not consulted. The chip follows the plan the Beat plan screen shows, which
 * states its status itself; nothing is approved in v1.
 */
export const onPlanDoctorIds = (view: BeatPlanView): ReadonlySet<string> | null => {
  switch (view.kind) {
    case 'route':
      return new Set(view.route.stops.map((stop) => stop.doctorId));
    case 'no-stops':
      return new Set();
    case 'loading':
    case 'unreachable':
    case 'no-plan':
    case 'syncing':
      return null;
  }
};
