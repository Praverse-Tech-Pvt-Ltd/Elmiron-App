import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BodyText as mockBodyText } from '@fieldforce/ui';

/**
 * `BE-W176` — Home's "Pending sync", on the screen, with the real queue (in-memory AsyncStorage).
 *
 * MR-47 is kept: a visit the phone made is listed apart from Today, with no day, until the pull
 * returns the server's copy. Then it shows only where the server's day puts it.
 */

const mockSession = jest.fn();
jest.mock('../session', () => ({ useSession: () => mockSession() }));
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  Redirect: ({ href }: { href: string }) => mockBodyText({ children: `redirect:${href}` }),
}));

import Home from '../../app/(tabs)/home';
import { asyncStorageQueueStore, setQueueOwner } from '../sync/async-storage-store';
import { unplannedVisitQueueItem } from '../sync/outbox';
import { emptyQueue, syncQueueReducer } from '../sync/reducer';

const REP = '22222222-2222-4222-8222-2222222222aa';
const VISIT = '66666666-6666-4666-8666-666666666601';
const DOCTOR = '33333333-3333-4333-8333-333333333301';
const CLINIC = '44444444-4444-4444-8444-444444444401';

const doctor = {
  id: DOCTOR,
  fullName: 'Dr Asha Deshpande',
  registrationNumber: null,
  specialty: null,
  qualification: null,
  territoryId: '11111111-1111-4111-8111-111111111103',
  assignedMrId: null,
  isActive: true,
  createdAt: '2026-09-01T08:00:00Z',
  updatedAt: '2026-09-01T08:00:00Z',
};
const clinic = {
  id: CLINIC,
  doctorId: DOCTOR,
  label: 'Main clinic',
  line1: '1 Road',
  line2: null,
  city: 'Pune',
  state: 'Maharashtra',
  postalCode: '411001',
  coordinates: null,
  geofenceRadiusMetres: 150,
};

const pulled = (visits: unknown[] = []) => ({
  store: {
    visit: new Map(visits.map((v) => [(v as { id: string }).id, v])),
    doctor: new Map([[DOCTOR, doctor]]),
    beat_plan: new Map(),
    beat_plan_entry: new Map(),
    clinic_address: new Map([[CLINIC, clinic]]),
  },
  status: 'ready',
  notice: null,
  failure: null,
  resynced: false,
  removals: [],
  zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  today: '2026-10-09',
  serverTime: '2026-10-09T10:00:00.000Z',
  dayOrigin: { kind: 'live' },
  refresh: jest.fn(),
});

const visitItem = unplannedVisitQueueItem({
  id: VISIT,
  doctorId: DOCTOR,
  clinicAddressId: CLINIC,
  scheduledFor: '2026-10-09T10:15:00.000Z',
  unplannedReason: 'Doctor called me in',
});

const putOnQueue = async (status: 'queued' | 'failed' = 'queued'): Promise<void> => {
  let state = syncQueueReducer(emptyQueue, { type: 'enqueued', item: visitItem });
  if (status === 'failed') {
    state = syncQueueReducer(syncQueueReducer(state, { type: 'batch_started', ids: [VISIT] }), {
      type: 'verdict_received',
      verdict: {
        id: VISIT,
        status: 'rejected',
        rejectionCode: 'validation_failed',
        sqlState: '22023',
        explanation: 'unplanned_visit_needs_reason',
        attemptsRemaining: 0,
        receivedAt: '2026-10-09T10:16:00Z',
        warnings: [],
      },
    });
  }
  await asyncStorageQueueStore.save(state);
};

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner(REP);
  mockSession.mockReturnValue({ status: 'signed-in', role: 'mr', signOut: jest.fn() });
  mockPush.mockClear();
});

describe('BE-W176 — Pending sync on Home', () => {
  it('an offline unplanned visit is listed under Pending sync -- doctor, clinic, Unplanned, waiting, no day', async () => {
    await putOnQueue();
    mockStore.mockReturnValue(pulled());
    await render(<Home />);

    expect(await screen.findByText('Pending sync')).toBeTruthy();
    expect(screen.getByText('Day will be confirmed after sync.')).toBeTruthy();
    expect(screen.getByText('Dr Asha Deshpande')).toBeTruthy();
    expect(screen.getByText(/Main clinic, Pune/u)).toBeTruthy();
    expect(screen.getByText(/Unplanned · Doctor called me in/u)).toBeTruthy();
    expect(screen.getByText(/Waiting to send/u)).toBeTruthy();
  });

  it('it is NOT part of Today: everything Today says is the same with or without it', async () => {
    /** Every string on screen, in order, up to (not including) the Pending sync section. */
    const todayLines = (): string[] => {
      const lines: string[] = [];
      const walk = (node: unknown): void => {
        if (typeof node === 'string') lines.push(node);
        else if (Array.isArray(node)) node.forEach(walk);
        else if (node !== null && typeof node === 'object' && 'children' in node) {
          walk(node.children);
        }
      };
      walk(screen.toJSON());
      const cut = lines.indexOf('Pending sync');
      return cut === -1 ? lines : lines.slice(0, cut);
    };

    mockStore.mockReturnValue(pulled());
    const without = await render(<Home />);
    await screen.findAllByText('Today');
    const before = todayLines();
    await without.unmount();

    await putOnQueue();
    await render(<Home />);
    await screen.findByText('Pending sync');
    // The ONE difference is Today's existing sync line, which counts it as unsent work -- the
    // pending state made visible. The day itself (counts, stops, actions) is untouched.
    const syncLine = (line: string): boolean =>
      line === '✓' || line === 'Everything sent' || / waiting · /u.test(line);
    expect(todayLines().filter((line) => !syncLine(line))).toEqual(
      before.filter((line) => !syncLine(line)),
    );
    expect(todayLines()).toContain('1 waiting · no signal');
  });

  it('tapping it reopens the visit', async () => {
    await putOnQueue();
    mockStore.mockReturnValue(pulled());
    await render(<Home />);
    await fireEvent.press(await screen.findByText('Dr Asha Deshpande'));
    expect(mockPush).toHaveBeenCalledWith(`/visit/${VISIT}`);
  });

  it('refused: shown as refused, with what to do -- and tapping it opens the queue, where recovery is', async () => {
    await putOnQueue('failed');
    mockStore.mockReturnValue(pulled());
    await render(<Home />);
    expect(await screen.findByText(/Refused by the server/u)).toBeTruthy();
    await fireEvent.press(screen.getByText('Dr Asha Deshpande'));
    expect(mockPush).toHaveBeenCalledWith('/queue');
  });

  it('once the pull has the server’s copy: no Pending sync, and the visit is counted on the server’s day once', async () => {
    await putOnQueue();
    mockStore.mockReturnValue(
      pulled([
        {
          id: VISIT,
          mrId: REP,
          doctorId: DOCTOR,
          beatPlanId: null,
          origin: 'unplanned',
          plannedDate: null,
          unplannedReason: 'Doctor called me in',
          clinicAddressId: CLINIC,
          status: 'completed',
          notMetReason: null,
          scheduledFor: '2026-10-09T10:15:00.000Z',
          startedAt: '2026-10-09T10:20:00.000Z',
          completedAt: '2026-10-09T10:40:00.000Z',
          visitDay: '2026-10-09',
          receivedAt: '2026-10-09T10:41:00.000Z',
          createdAt: '2026-10-09T10:41:00.000Z',
          updatedAt: '2026-10-09T10:41:00.000Z',
        },
      ]),
    );
    await render(<Home />);
    await screen.findAllByText('Today');
    expect(screen.queryByText('Pending sync')).toBeNull();
    expect(screen.queryAllByText('Dr Asha Deshpande')).toHaveLength(0);
  });

  it('no signed-in rep: nothing pending leaks onto the screen', async () => {
    await putOnQueue();
    setQueueOwner(null);
    mockStore.mockReturnValue(pulled());
    await render(<Home />);
    await screen.findAllByText('Today');
    expect(screen.queryByText('Pending sync')).toBeNull();
  });
});
