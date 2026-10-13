import { describe, expect, it } from 'vitest';
import type { RetentionOverview, TerritoryNode } from '@fieldforce/core';
import {
  accessWarnings,
  adminRefusal,
  dayAfterStart,
  dayStart,
  hoursSource,
  managersFor,
  retentionAlerts,
  territoriesFor,
  territoryOption,
  treeOrder,
  weekdaysLabel,
} from './admin-text';
import { auditQuery, readAuditFilters } from './audit-filters';

/**
 * `FE-W75`–`FE-W78`. Each message below is the database's own text from
 * `20261013000200`…`20261013000230`, so a reworded refusal there fails here instead of reaching an
 * admin as a raw SQL sentence.
 */
describe('adminRefusal — the runbook’s five silent mistakes, as an admin reads them', () => {
  it.each([
    [
      "admin_confirmation_mismatch: type the new admin's email again",
      /type their email address again/u,
    ],
    [
      'territory_level_for_rep: a rep is placed on an Area/Territory',
      /lowest level of its branch/u,
    ],
    [
      "territory_not_in_organisation: territory x is not one of your company's",
      /not one of your company/u,
    ],
    ['rep_needs_manager: a rep must report to a manager', /reporting manager/u],
    ['account_unconfirmed: the account for a@b.c is not confirmed', /not confirmed/u],
  ])('%s', (message, expected) => {
    expect(adminRefusal({ code: '22023', message })).toMatch(expected);
  });

  it('names the territory and hours refusals', () => {
    expect(adminRefusal({ message: 'territory_too_deep: X is an Area/Territory' })).toMatch(
      /lowest level/u,
    );
    expect(adminRefusal({ message: 'territory_code_taken: X is already used' })).toMatch(
      /whole system/u,
    );
    expect(adminRefusal({ message: 'parent_has_reps: 1 rep(s)' })).toMatch(/Move them first/u);
    expect(adminRefusal({ message: 'timezone_unknown: Mars/Base' })).toMatch(/Asia\/Kolkata/u);
  });

  it('matches the Edge Function’s own codes, which arrive in `code`', () => {
    expect(adminRefusal({ code: 'not_configured', message: 'This server cannot …' })).toMatch(
      /no secret key/u,
    );
  });

  it('passes anything unknown through, unsoftened', () => {
    expect(adminRefusal({ code: 'XX000', message: 'something new' })).toBe(
      'The server refused this: something new',
    );
  });
});

const node = (
  over: Partial<TerritoryNode> & Pick<TerritoryNode, 'id' | 'code'>,
): TerritoryNode => ({
  parentId: null,
  name: over.code,
  depth: 1,
  children: 0,
  activeUsers: 0,
  reps: 0,
  doctors: 0,
  ownHours: null,
  hours: null,
  ...over,
});

const NATIONAL = node({ id: 'n', code: 'IN', depth: 1, children: 2 });
const WEST = node({ id: 'w', code: 'IN-W', parentId: 'n', depth: 2, children: 2 });
const PUNE = node({ id: 'p', code: 'IN-W-PUN', parentId: 'w', depth: 3 });
const NAGPUR = node({ id: 'g', code: 'IN-W-NAG', parentId: 'w', depth: 3 });
const SOUTH = node({ id: 's', code: 'IN-S', parentId: 'n', depth: 2 });

describe('the territory pickers', () => {
  it('offers a rep only the bottom of a branch below the top, an admin nothing, a manager all', () => {
    const all = [NATIONAL, WEST, PUNE, NAGPUR, SOUTH];
    expect(territoriesFor('mr', all).map((t) => t.code)).toEqual(['IN-W-PUN', 'IN-W-NAG', 'IN-S']);
    expect(territoriesFor('admin', all)).toEqual([]);
    expect(territoriesFor('field_manager', all)).toHaveLength(5);
  });

  it('names the level with the code, so a wrong territory is visible in the picker', () => {
    expect(territoryOption(WEST)).toBe('Region · IN-W — IN-W');
    expect(territoryOption(PUNE)).toMatch(/^Area\/Territory · IN-W-PUN/u);
  });

  it('orders the tree depth-first, siblings by code, and roots a manager’s subtree at its top', () => {
    expect(
      treeOrder([PUNE, SOUTH, NATIONAL, NAGPUR, WEST]).map(
        (r) => `${r.node.code}:${String(r.indent)}`,
      ),
    ).toEqual(['IN:0', 'IN-S:1', 'IN-W:1', 'IN-W-NAG:2', 'IN-W-PUN:2']);
    expect(
      treeOrder([PUNE, WEST, NAGPUR]).map((r) => `${r.node.code}:${String(r.indent)}`),
    ).toEqual(['IN-W:0', 'IN-W-NAG:1', 'IN-W-PUN:1']);
  });

  it('says where a territory’s hours come from', () => {
    const codeOf = (id: string) => ({ w: 'IN-W' })[id as 'w'];
    const hours = {
      shiftStart: '09:00:00',
      shiftEnd: '18:00:00',
      timezone: 'Asia/Kolkata',
      graceMinutes: 15,
      activeWeekdays: [1],
    };
    expect(
      hoursSource(
        { ownHours: hours, hours: { ...hours, source: 'territory', resolvedFromTerritoryId: 'p' } },
        codeOf,
      ),
    ).toBe('Its own hours');
    expect(
      hoursSource(
        { ownHours: null, hours: { ...hours, source: 'territory', resolvedFromTerritoryId: 'w' } },
        codeOf,
      ),
    ).toBe('Inherited from IN-W');
    expect(
      hoursSource(
        {
          ownHours: null,
          hours: { ...hours, source: 'org_default', resolvedFromTerritoryId: null },
        },
        codeOf,
      ),
    ).toBe('The company default');
    expect(hoursSource({ ownHours: null, hours: null }, codeOf)).toMatch(/check-in is refused/u);
  });

  it('labels working days as a run or a list', () => {
    expect(weekdaysLabel([1, 2, 3, 4, 5, 6])).toBe('Mon–Sat');
    expect(weekdaysLabel([1, 3, 5])).toBe('Mon, Wed, Fri');
    expect(weekdaysLabel([])).toBe('No working days');
  });
});

describe('the users list', () => {
  it('offers active managers and admins as managers, never the person themselves', () => {
    const users = [
      { id: 'a', role: 'admin' as const, isActive: true },
      { id: 'm', role: 'field_manager' as const, isActive: true },
      { id: 'x', role: 'field_manager' as const, isActive: false },
      { id: 'r', role: 'mr' as const, isActive: true },
    ];
    expect(managersFor(users, null)).toEqual(['a', 'm']);
    expect(managersFor(users, 'm')).toEqual(['a']);
  });

  it('warns about an account that cannot sign in and a rep nobody manages', () => {
    expect(
      accessWarnings({ role: 'mr', confirmed: false, managerId: null, isActive: true }),
    ).toHaveLength(2);
    expect(
      accessWarnings({ role: 'admin', confirmed: true, managerId: null, isActive: true }),
    ).toEqual([]);
  });
});

describe('the audit filters', () => {
  it('reads a URL, dropping anything malformed rather than sending it', () => {
    const f = readAuditFilters({
      actor: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01',
      table: 'user_profiles',
      action: 'drop',
      from: '2026-10-01',
      until: 'yesterday',
      before: '120',
      refused: '1',
    });
    expect(f).toEqual({
      actor: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01',
      table: 'user_profiles',
      action: null,
      from: '2026-10-01',
      until: null,
      before: 120,
      refused: true,
    });
    expect(readAuditFilters({ actor: "x' or 1=1", table: 'Robert"); drop' })).toMatchObject({
      actor: null,
      table: null,
    });
  });

  it('writes the filters back into a link, empty ones left out', () => {
    expect(auditQuery(readAuditFilters({}))).toBe('/audit');
    expect(auditQuery({ ...readAuditFilters({ table: 'territories' }), before: 9 })).toBe(
      '/audit?table=territories&before=9',
    );
  });

  it('a typed day is India time; "until" is inclusive, so the bound is the next day’s start', () => {
    expect(dayStart('2026-10-13')).toBe('2026-10-13T00:00:00+05:30');
    expect(dayAfterStart('2026-10-31')).toBe('2026-11-01T00:00:00+05:30');
    expect(dayAfterStart('2026-12-31')).toBe('2027-01-01T00:00:00+05:30');
    expect(dayStart('13/10/2026')).toBeNull();
  });
});

const overview = (over: Partial<RetentionOverview> = {}): RetentionOverview => ({
  retentionDays: 90,
  thresholds: { purgeBatchLimit: 250, purgeBacklogMultiplier: 3, purgeMaxSilenceHours: 12 },
  yours: {
    liveRecordings: 3,
    liveVoiceNotes: 1,
    overdueRecordings: 0,
    overdueVoiceNotes: 0,
    destroyedRecordings: 5,
    destroyedVoiceNotes: 0,
    oldestOverdueAt: null,
  },
  worker: {
    lastRunAt: '2026-10-13T05:00:00+00:00',
    lastSuccessfulRunAt: '2026-10-13T05:00:10+00:00',
    stalled: false,
  },
  runs: [],
  appendOnlyTables: ['audit_log'],
  readAt: '2026-10-13T05:10:00+00:00',
  auditLogId: 7,
  ...over,
});

describe('retention alerts', () => {
  it('says nothing when the worker keeps up', () => {
    expect(retentionAlerts(overview())).toEqual([]);
  });

  it('a stall is critical and comes first; overdue audio and a never-run worker are named', () => {
    const alerts = retentionAlerts(
      overview({
        worker: { lastRunAt: null, lastSuccessfulRunAt: null, stalled: true },
        yours: { ...overview().yours, overdueRecordings: 2, overdueVoiceNotes: 1 },
      }),
    );
    expect(alerts[0]?.tone).toBe('critical');
    expect(alerts.map((a) => a.text).join(' ')).toMatch(/3 of your company’s audio/u);
    expect(alerts.map((a) => a.text).join(' ')).toMatch(/never run/u);
  });
});
