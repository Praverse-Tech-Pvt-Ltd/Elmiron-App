import { describe, expect, it } from 'vitest';
import {
  canReassign,
  grantRefusal,
  grantStateLabel,
  originLabel,
  planRefusal,
  reassignRefusal,
} from './planning-text';

/**
 * `BE-C78`. Each message below is the database's own text from `20261009000200_manager_planning`,
 * so a reworded refusal there fails here instead of reaching a manager as a raw SQL sentence.
 */
describe('planRefusal', () => {
  it('names each refusal a manager can act on', () => {
    expect(
      planRefusal({
        code: '22023',
        message: "plan_date_in_past: 2020-01-01 has ended in the rep's timezone",
      }),
    ).toMatch(/already ended/u);
    expect(
      planRefusal({ code: '42501', message: "only a field manager plans a rep's day" }),
    ).toMatch(/Admins grant/u);
    expect(
      planRefusal({ code: '42501', message: 'you may not plan for rep x on 2030-01-16' }),
    ).toMatch(/outside your territory/u);
    expect(
      planRefusal({
        code: '42501',
        message: "doctor d is not an active doctor in rep r's territory",
      }),
    ).toMatch(/not an active doctor/u);
    expect(planRefusal({ code: '22023', message: 'doctor d appears twice in one plan' })).toMatch(
      /twice/u,
    );
  });

  it('passes anything unknown through, unsoftened', () => {
    expect(planRefusal({ code: 'XX000', message: 'something new' })).toBe(
      'The server refused this: something new',
    );
  });
});

describe('reassignRefusal', () => {
  it('names each refusal', () => {
    expect(reassignRefusal({ message: 'reassignment_needs_reason' })).toMatch(/Say why/u);
    expect(
      reassignRefusal({ message: 'doctor_outside_target_territory: doctor d is not in rep r' }),
    ).toMatch(/does not cover/u);
    expect(
      reassignRefusal({ message: 'visit_not_reassignable: visit v is planned and in_progress' }),
    ).toMatch(/has not started/u);
  });
});

describe('grantRefusal', () => {
  it('names each refusal', () => {
    expect(grantRefusal({ message: 'only an admin grants planning access' })).toMatch(
      /Only an admin/u,
    );
    expect(
      grantRefusal({ message: 'user u is not an active field manager in your organisation' }),
    ).toMatch(/active field manager/u);
    expect(grantRefusal({ message: 'territory t is not in your organisation' })).toMatch(
      /not one of your company/u,
    );
    expect(
      grantRefusal({
        message:
          'new row for relation "planning_territory_grants" violates check constraint "planning_grants_dates_ordered"',
      }),
    ).toMatch(/before the start/u);
  });
});

describe('origin and reassignment rules on screen', () => {
  it('never calls an unclassified visit unplanned', () => {
    expect(originLabel('unclassified')).not.toMatch(/unplanned/iu);
    expect(originLabel('unplanned')).toBe('Unplanned');
  });

  it('offers a move only for an unstarted planned visit on a day that has not ended', () => {
    const planned = { origin: 'planned' as const, status: 'planned' as const, startedAt: null };
    expect(canReassign(planned, '2030-01-16', '2030-01-15')).toBe(true);
    expect(canReassign(planned, '2030-01-16', '2030-01-16')).toBe(true);
    expect(canReassign(planned, '2030-01-14', '2030-01-15')).toBe(false);
    expect(canReassign({ ...planned, status: 'in_progress' }, '2030-01-16', '2030-01-15')).toBe(
      false,
    );
    expect(canReassign({ ...planned, origin: 'unplanned' }, null, '2030-01-15')).toBe(false);
  });
});

/**
 * The cases the database deliberately answers ALIKE. A missing grant, an expired one, a revoked one
 * and a rep in another company all raise the same `you may not plan for rep … on …` (`plannable_rep`):
 * a separate message for each would tell a manager which reps exist outside their scope. The screen
 * therefore gives one sentence that names both things the manager can act on.
 */
describe('one refusal for every out-of-scope rep', () => {
  const outOfScope = { code: '42501', message: 'you may not plan for rep 7c1d… on 2030-01-17' };
  it('reads the same for no grant, an expired or revoked grant, and another company', () => {
    expect(planRefusal(outOfScope)).toBe(
      'This rep is outside your territory on that day, and no admin has granted you access. Nothing was saved.',
    );
    expect(reassignRefusal(outOfScope)).toMatch(/outside your planning scope/u);
  });

  it('says why a completed or started visit cannot move, not just that it cannot', () => {
    for (const status of ['completed', 'in_progress', 'not_met']) {
      expect(
        reassignRefusal({
          code: '22023',
          message: `visit_not_reassignable: visit v is planned and ${status}`,
        }),
      ).toBe(
        'Only a planned visit that has not started can move. A visit already worked stays with the rep who worked it.',
      );
    }
    expect(
      reassignRefusal({
        code: '22023',
        message: 'visit_not_reassignable: visit v is unplanned and completed',
      }),
    ).toMatch(/has not started/u);
  });

  it('never shows a bare SQLSTATE', () => {
    for (const refusal of [
      planRefusal({ code: '42501', message: 'something unforeseen' }),
      reassignRefusal({ code: '22023', message: 'something unforeseen' }),
      grantRefusal({ code: '42501', message: 'something unforeseen' }),
    ]) {
      expect(refusal).not.toMatch(/^\d{5}$|42501|22023/u);
      expect(refusal).toContain('something unforeseen');
    }
  });

  it('names an admin trying to plan, and a grant of another company', () => {
    expect(grantRefusal({ code: '42501', message: 'grant g is not yours' })).toMatch(
      /not one of your company/u,
    );
    expect(
      grantRefusal({ code: '42501', message: 'only an admin revokes planning access' }),
    ).toMatch(/Only an admin/u);
    expect(grantStateLabel('ended')).toBe('Ended');
  });
});
