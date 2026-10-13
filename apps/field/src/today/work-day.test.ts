import { describe, expect, it } from 'vitest';
import { SyncQueueItemSchema, VisitSchema, WorkDaySchema, fromWorkDayRow } from '@fieldforce/core';
import type { SyncQueueItem, Visit, WorkDay } from '@fieldforce/core';
import { workDayQueueItem } from '../sync/outbox';
import { workDayCopy } from './day-end';
import { endDayBlocker, isDayOpen, workDayFor, workDayRequest, workDayStatus } from './work-day';

/**
 * `FE-W80` / `BE-W190` — the working day, as the phone reads it.
 *
 * Every row is parsed through the contract (`fromWorkDayRow`, the mapper the pull uses), so a
 * fixture that drifts from what the server sends fails here rather than passing quietly.
 */
const MR = '22222222-2222-4222-8222-2222222222aa';
const OTHER_MR = '22222222-2222-4222-8222-2222222222ab';
const TODAY = '2026-10-13';
const IST = { timeZone: 'Asia/Kolkata', source: 'territory' } as const;

const row = (over: Record<string, unknown> = {}) => ({
  id: '55555555-5555-4555-8555-555555555501',
  organisation_id: '55555555-5555-4555-8555-5555555555aa',
  mr_id: MR,
  territory_id: null,
  work_date: TODAY,
  time_zone: 'Asia/Kolkata',
  // 08:55 IST, as the server sends it: in UTC.
  opened_at: '2026-10-13T03:25:00.123456+00:00',
  opened_via: 'check_in',
  client_opened_at: '2026-10-13T03:24:50+00:00',
  open_request_id: null,
  closed_at: null,
  close_request_id: null,
  client_closed_at: null,
  closing_note: null,
  visits_total: null,
  visits_completed: null,
  visits_not_met: null,
  visits_missed: null,
  visits_unplanned: null,
  check_in_count: null,
  distance_metres: null,
  samples_quantity: null,
  inputs_quantity: null,
  reopen_count: 0,
  created_at: '2026-10-13T03:25:00+00:00',
  updated_at: '2026-10-13T03:25:00+00:00',
  ...over,
});

const closedRow = (over: Record<string, unknown> = {}) =>
  row({
    // 18:22 IST.
    closed_at: '2026-10-13T12:52:00+00:00',
    close_request_id: '66666666-6666-4666-8666-666666666601',
    client_closed_at: '2026-10-13T12:51:58+00:00',
    visits_total: 5,
    visits_completed: 3,
    visits_not_met: 1,
    visits_missed: 1,
    visits_unplanned: 0,
    check_in_count: 4,
    distance_metres: 48_200,
    samples_quantity: 6,
    inputs_quantity: 0,
    updated_at: '2026-10-13T12:52:00+00:00',
    ...over,
  });

const storeOf = (...days: WorkDay[]) => ({ work_day: new Map(days.map((d) => [d.id, d])) });

const closeItem = (over: Partial<SyncQueueItem> = {}, date = TODAY): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    ...workDayQueueItem(
      workDayRequest({
        id: '66666666-6666-4666-8666-666666666601',
        action: 'close',
        workDate: date,
        occurredAt: '2026-10-13T12:51:58+00:00',
      }),
    ),
    ...over,
  });

const visit = (status: Visit['status'], id: string): Visit =>
  VisitSchema.parse({
    id,
    mrId: MR,
    doctorId: '22222222-2222-4222-8222-2222222222bb',
    beatPlanId: null,
    clinicAddressId: null,
    status,
    notMetReason: null,
    scheduledFor: null,
    startedAt: status === 'planned' ? null : '2026-10-13T03:25:00+00:00',
    completedAt: status === 'completed' ? '2026-10-13T04:25:00+00:00' : null,
    receivedAt: '2026-10-13T03:25:01+00:00',
    createdAt: '2026-10-13T02:30:00+00:00',
    updatedAt: '2026-10-13T03:25:01+00:00',
    visitDay: TODAY,
  });

describe('the server row is the answer', () => {
  it('maps the pulled row through the contract, snapshot all or nothing', () => {
    const open = fromWorkDayRow(row());
    expect(open.closedAt).toBeNull();
    expect(open.totals).toBeNull();
    const closed = fromWorkDayRow(closedRow());
    expect(closed.totals?.visitsTotal).toBe(5);
    // A closed row without its snapshot is refused, never rendered with figures missing.
    expect(() => fromWorkDayRow(closedRow({ visits_total: null }))).toThrow();
    expect(WorkDaySchema.safeParse(open).success).toBe(true);
  });

  it('finds this rep’s day for this date, and not another rep’s or another date’s', () => {
    const mine = fromWorkDayRow(row());
    const theirs = fromWorkDayRow(
      row({ id: '55555555-5555-4555-8555-555555555502', mr_id: OTHER_MR }),
    );
    const yesterday = fromWorkDayRow(
      row({ id: '55555555-5555-4555-8555-555555555503', work_date: '2026-10-12' }),
    );
    expect(workDayFor(storeOf(theirs, yesterday, mine), MR, TODAY)?.id).toBe(mine.id);
    expect(workDayFor(storeOf(theirs, yesterday), MR, TODAY)).toBeNull();
  });

  it('is UNKNOWN with no server day or no rep — never a guess', () => {
    const day = fromWorkDayRow(row());
    expect(workDayStatus(storeOf(day), MR, null, []).kind).toBe('unknown');
    expect(workDayStatus(storeOf(day), null, TODAY, []).kind).toBe('unknown');
  });

  it('reads not started, open and closed off the server row', () => {
    expect(workDayStatus(storeOf(), MR, TODAY, []).kind).toBe('not_started');
    expect(workDayStatus(storeOf(fromWorkDayRow(row())), MR, TODAY, []).kind).toBe('open');
    expect(workDayStatus(storeOf(fromWorkDayRow(closedRow())), MR, TODAY, []).kind).toBe('closed');
  });
});

describe('what this phone is still sending', () => {
  const open = fromWorkDayRow(row());

  it('an end pressed with no signal is ENDING, not sent — and not closed', () => {
    const status = workDayStatus(storeOf(open), MR, TODAY, [closeItem()]);
    expect(status).toMatchObject({ kind: 'ending', sent: false });
  });

  it('an end the server accepted, before the pull brings it, is ENDING and sent', () => {
    const status = workDayStatus(storeOf(open), MR, TODAY, [
      closeItem({ status: 'synced', syncedAt: '2026-10-13T12:52:01+00:00' }),
    ]);
    expect(status).toMatchObject({ kind: 'ending', sent: true });
  });

  it('the server’s closed row wins over anything still on the phone', () => {
    const status = workDayStatus(storeOf(fromWorkDayRow(closedRow())), MR, TODAY, [closeItem()]);
    expect(status.kind).toBe('closed');
  });

  it('a manager’s REOPENING, newer than the phone’s sent end, wins: the day is open again', () => {
    // The row moved AFTER the server accepted the end: that is the newer word.
    const reopened = fromWorkDayRow(
      row({ reopen_count: 1, updated_at: '2026-10-13T13:30:00+00:00' }),
    );
    const status = workDayStatus(storeOf(reopened), MR, TODAY, [
      closeItem({ status: 'synced', syncedAt: '2026-10-13T12:52:01+00:00' }),
    ]);
    expect(status.kind).toBe('open');
  });

  it('a REFUSED end changes nothing about the day', () => {
    const status = workDayStatus(storeOf(open), MR, TODAY, [closeItem({ status: 'failed' })]);
    expect(status.kind).toBe('open');
  });

  it('an act for ANOTHER date does not move today', () => {
    const status = workDayStatus(storeOf(open), MR, TODAY, [closeItem({}, '2026-10-12')]);
    expect(status.kind).toBe('open');
  });

  it('a "start my day" waiting to send is OPEN, on the phone’s word', () => {
    const start = SyncQueueItemSchema.parse(
      workDayQueueItem(
        workDayRequest({
          id: '66666666-6666-4666-8666-666666666602',
          action: 'open',
          workDate: TODAY,
          occurredAt: '2026-10-13T03:20:00+00:00',
        }),
      ),
    );
    expect(workDayStatus(storeOf(), MR, TODAY, [start])).toMatchObject({
      kind: 'open',
      day: null,
      pendingStart: true,
    });
  });
});

describe('isDayOpen — the live-tracking rule’s `dayOpen`', () => {
  it('is true only while the day is open: started and not ended', () => {
    const open = fromWorkDayRow(row());
    expect(isDayOpen(workDayStatus(storeOf(open), MR, TODAY, []))).toBe(true);
    // Every other state stops tracking -- including an end not yet sent: the rep has ended it.
    expect(isDayOpen(workDayStatus(storeOf(open), MR, TODAY, [closeItem()]))).toBe(false);
    expect(isDayOpen(workDayStatus(storeOf(fromWorkDayRow(closedRow())), MR, TODAY, []))).toBe(
      false,
    );
    expect(isDayOpen(workDayStatus(storeOf(), MR, TODAY, []))).toBe(false);
    expect(isDayOpen(workDayStatus(storeOf(open), MR, null, []))).toBe(false);
  });
});

describe('ending the day', () => {
  it('is blocked while a visit is checked in, and says so', () => {
    expect(endDayBlocker([visit('completed', '22222222-2222-4222-8222-222222222201')])).toBeNull();
    expect(
      endDayBlocker([
        visit('in_progress', '22222222-2222-4222-8222-222222222201'),
        visit('completed', '22222222-2222-4222-8222-222222222202'),
      ]),
    ).toMatch(/A visit is still checked in/u);
    expect(
      endDayBlocker([
        visit('in_progress', '22222222-2222-4222-8222-222222222201'),
        visit('in_progress', '22222222-2222-4222-8222-222222222202'),
      ]),
    ).toMatch(/^2 visits are still checked in/u);
  });

  it('sends a note only with an END, trimmed, and none when blank', () => {
    const base = { id: '66666666-6666-4666-8666-666666666601', workDate: TODAY } as const;
    const occurredAt = '2026-10-13T12:51:58+00:00';
    expect(
      workDayRequest({ ...base, action: 'close', occurredAt, note: '  Car broke down ' }).note,
    ).toBe('Car broke down');
    expect(workDayRequest({ ...base, action: 'close', occurredAt, note: '   ' }).note).toBeNull();
    expect(
      workDayRequest({ ...base, action: 'open', occurredAt, note: 'ignored' }).note,
    ).toBeNull();
  });
});

describe('what the card says', () => {
  it('shows the SERVER’s stamps in the territory zone', () => {
    const open = workDayCopy(
      workDayStatus(storeOf(fromWorkDayRow(row())), MR, TODAY, []),
      IST,
      null,
    );
    expect(open?.title).toBe('Your day is open — started 08:55');
    expect(open?.offerEnd).toBe(true);
    const closed = workDayCopy(
      workDayStatus(storeOf(fromWorkDayRow(closedRow())), MR, TODAY, []),
      IST,
      null,
    );
    expect(closed?.title).toBe('Day ended at 18:22');
    expect(closed?.detail).toMatch(/4 of 5 visits attended/u);
    expect(closed?.offerEnd).toBe(false);
  });

  it('says an unsent end is the PHONE’s, with no time on it', () => {
    const copy = workDayCopy(
      workDayStatus(storeOf(fromWorkDayRow(row())), MR, TODAY, [closeItem()]),
      IST,
      null,
    );
    expect(copy?.title).toBe('Ended on this phone — waiting to send');
    expect(copy?.title).not.toMatch(/\d\d:\d\d/u);
    expect(copy?.offerEnd).toBe(false);
  });

  it('shows a refusal as a refusal, and offers the button again', () => {
    const copy = workDayCopy(
      workDayStatus(storeOf(fromWorkDayRow(row())), MR, TODAY, [closeItem({ status: 'failed' })]),
      IST,
      { title: 'Your day was not ended', detail: 'A visit is still checked in.' },
    );
    expect(copy).toMatchObject({
      tone: 'refused',
      offerEnd: true,
      title: 'Your day was not ended',
    });
  });

  it('draws nothing when there is no server day to read', () => {
    expect(workDayCopy({ kind: 'unknown' }, IST, null)).toBeNull();
  });
});
