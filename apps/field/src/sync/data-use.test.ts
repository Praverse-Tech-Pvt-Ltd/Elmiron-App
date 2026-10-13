import { describe, expect, it } from 'vitest';
import type { KeyValue } from '../settings/data-prefs';
import {
  MONTHLY_NOTE_BYTES,
  accrue,
  dataNoteFor,
  dataUseFrom,
  indiaMonthOf,
  megabytes,
  usedThisMonth,
  utf8Length,
} from './data-use';
import { DATA_USE_KEY, dataUseRecorder, readDataUse } from './data-use-store';

/**
 * `FE-W137` — the month's count of this app's mobile-data uploads, and the note it earns.
 */

const memory = (): KeyValue & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => Promise.resolve(map.get(key) ?? null),
    setItem: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
  };
};

describe('the month is India’s, from the server’s clock', () => {
  it('turns over at midnight IST, which is 18:30 UTC the day before', () => {
    expect(indiaMonthOf('2026-10-31T18:29:59.000Z')).toBe('2026-10');
    expect(indiaMonthOf('2026-10-31T18:30:00.000Z')).toBe('2026-11');
    // An offset the server might send is honoured, not sliced.
    expect(indiaMonthOf('2026-11-01T00:10:00.000+05:30')).toBe('2026-11');
    expect(indiaMonthOf('2026-12-31T20:00:00.000Z')).toBe('2027-01');
  });

  it('an instant that does not parse belongs to no month', () => {
    expect(indiaMonthOf('not a time')).toBeNull();
  });
});

describe('accrual, and the monthly reset', () => {
  it('adds within a month and starts again in the next', () => {
    let record = accrue(null, 1_000, '2026-10-05T06:00:00Z');
    record = accrue(record, 2_500, '2026-10-31T18:00:00Z');
    expect(record).toEqual({ month: '2026-10', bytes: 3_500 });
    // 00:05 IST on 1 November.
    record = accrue(record, 700, '2026-10-31T18:35:00Z');
    expect(record).toEqual({ month: '2026-11', bytes: 700 });
  });

  it('an answer from a month already over does not inflate the new one', () => {
    const november = { month: '2026-11', bytes: 700 };
    expect(accrue(november, 9_999, '2026-10-31T18:00:00Z')).toBe(november);
  });

  it('nothing, a negative or an unparseable time changes nothing', () => {
    const record = { month: '2026-10', bytes: 10 };
    expect(accrue(record, 0, '2026-10-05T06:00:00Z')).toBe(record);
    expect(accrue(record, -5, '2026-10-05T06:00:00Z')).toBe(record);
    expect(accrue(record, Number.NaN, '2026-10-05T06:00:00Z')).toBe(record);
    expect(accrue(record, 5, 'garbage')).toBe(record);
  });

  it('last month’s record reads as nothing this month, before any new upload', () => {
    const october = { month: '2026-10', bytes: 150_000_000 };
    expect(usedThisMonth(october, '2026-10-20T06:00:00Z')).toBe(150_000_000);
    expect(usedThisMonth(october, '2026-11-02T06:00:00Z')).toBe(0);
    // No server instant, no month: nothing is claimed.
    expect(usedThisMonth(october, null)).toBe(0);
  });
});

describe('the note on Today — over 100 MB, switch on', () => {
  const now = '2026-10-20T06:00:00Z';
  const at = (bytes: number) => ({ month: '2026-10', bytes });

  it('is silent at exactly 100 MB, and speaks one byte over', () => {
    expect(
      dataNoteFor({ warnOn: true, record: at(MONTHLY_NOTE_BYTES), serverTime: now }),
    ).toBeNull();
    const note = dataNoteFor({ warnOn: true, record: at(MONTHLY_NOTE_BYTES + 1), serverTime: now });
    expect(note?.title).toBe('This app has sent 100 MB over mobile data this month');
  });

  it('says what is counted and that nothing stopped', () => {
    const note = dataNoteFor({ warnOn: true, record: at(123_400_000), serverTime: now });
    expect(note).toEqual({
      title: 'This app has sent 123 MB over mobile data this month',
      detail:
        'That is its uploads only — not downloads, and not other apps. Nothing has stopped working.',
    });
  });

  it('is silent with the switch off, with no server time, and in a new month', () => {
    const big = at(500_000_000);
    expect(dataNoteFor({ warnOn: false, record: big, serverTime: now })).toBeNull();
    expect(dataNoteFor({ warnOn: true, record: big, serverTime: null })).toBeNull();
    expect(
      dataNoteFor({ warnOn: true, record: big, serverTime: '2026-11-01T06:00:00Z' }),
    ).toBeNull();
  });

  it('100 MB is decimal megabytes', () => {
    expect(MONTHLY_NOTE_BYTES).toBe(100_000_000);
    expect(megabytes(12_400_000)).toBe('12.4 MB');
    expect(megabytes(0)).toBe('0.0 MB');
    expect(megabytes(140_000_000)).toBe('140 MB');
  });
});

describe('persistence', () => {
  it('a recorded upload is read back, and a new month replaces the old', async () => {
    const storage = memory();
    const record = dataUseRecorder(storage);
    await record({ bytes: 1_000, serverTime: '2026-10-05T06:00:00Z' });
    await record({ bytes: 2_000, serverTime: '2026-10-06T06:00:00Z' });
    await expect(readDataUse(storage)).resolves.toEqual({ month: '2026-10', bytes: 3_000 });
    await record({ bytes: 5, serverTime: '2026-11-01T06:00:00Z' });
    await expect(readDataUse(storage)).resolves.toEqual({ month: '2026-11', bytes: 5 });
  });

  it('two uploads finishing together are both counted', async () => {
    const storage = memory();
    const record = dataUseRecorder(storage);
    await Promise.all([
      record({ bytes: 100, serverTime: '2026-10-05T06:00:00Z' }),
      record({ bytes: 200, serverTime: '2026-10-05T06:00:01Z' }),
      record({ bytes: 300, serverTime: '2026-10-05T06:00:02Z' }),
    ]);
    await expect(readDataUse(storage)).resolves.toEqual({ month: '2026-10', bytes: 600 });
  });

  it('a failed write does not stop the next one', async () => {
    const storage = memory();
    let fail = true;
    const flaky: KeyValue = {
      getItem: storage.getItem,
      setItem: (key, value) => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error('disk full'));
        }
        return storage.setItem(key, value);
      },
    };
    const record = dataUseRecorder(flaky);
    await expect(record({ bytes: 1, serverTime: '2026-10-05T06:00:00Z' })).rejects.toThrow();
    await record({ bytes: 2, serverTime: '2026-10-05T06:00:00Z' });
    await expect(readDataUse(storage)).resolves.toEqual({ month: '2026-10', bytes: 2 });
  });

  it('a corrupt or unreadable value counts nothing', async () => {
    expect(dataUseFrom('{oops')).toBeNull();
    expect(dataUseFrom(JSON.stringify({ month: 'October', bytes: 5 }))).toBeNull();
    expect(dataUseFrom(JSON.stringify({ month: '2026-10', bytes: -1 }))).toBeNull();
    const broken: KeyValue = {
      getItem: () => Promise.reject(new Error('no storage')),
      setItem: () => Promise.resolve(),
    };
    await expect(readDataUse(broken)).resolves.toBeNull();
    const storage = memory();
    storage.map.set(DATA_USE_KEY, 'garbage');
    await expect(readDataUse(storage)).resolves.toBeNull();
  });
});

describe('the wire size of a JSON body', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('—')).toBe(3);
    expect(utf8Length('₹')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });
});
