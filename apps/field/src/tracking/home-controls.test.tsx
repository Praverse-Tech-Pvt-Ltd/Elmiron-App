import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { LiveTrackingStatus } from '@fieldforce/core';
import type { LiveTracker } from './tracker';

/**
 * `FE-W220` — Today's start and stop for live location. The buttons are the tracker's own; what is
 * proved here is WHEN they are offered: never before the notice is accepted.
 */
let mockTracker: LiveTracker | null = null;
jest.mock('./tracker', () => ({ useLiveTracker: () => mockTracker }));

import { LiveTrackingHomeControls } from './home-controls';

const NOTICE = '4e86b49c-05fc-4bd8-9f75-16e22a64309a';
const status = (over: Partial<LiveTrackingStatus> = {}): LiveTrackingStatus => ({
  companyEnabled: true,
  intervalSeconds: 300,
  notice: { id: NOTICE, versionLabel: 'v1', body: 'The notice.', isDraft: false },
  accepted: true,
  acceptedNoticeVersionId: NOTICE,
  withinWorkingHours: true,
  shiftEnd: '18:00:00',
  timeZone: 'Asia/Kolkata',
  today: '2026-10-13',
  serverTime: '2026-10-13T05:38:23+00:00',
  ...over,
});

const tracker = (over: Partial<LiveTracker> = {}): LiveTracker => ({
  status: status(),
  state: 'paused_day_closed',
  line: { title: 'Off.', detail: null, tone: 'info' },
  dayOpen: false,
  readingNow: false,
  busy: false,
  refresh: jest.fn(),
  accept: jest.fn<LiveTracker['accept']>().mockResolvedValue('accepted'),
  withdraw: jest.fn<LiveTracker['withdraw']>().mockResolvedValue(true),
  openDay: jest.fn<LiveTracker['openDay']>().mockResolvedValue(undefined),
  closeDay: jest.fn<LiveTracker['closeDay']>().mockResolvedValue(undefined),
  ...over,
});

const onOpenLocation = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockTracker = null;
});

describe('FE-W220 — live location is started and stopped from Today', () => {
  it('offers nothing before the notice is accepted: the way in is still the notice', async () => {
    mockTracker = tracker({ status: status({ accepted: false, acceptedNoticeVersionId: null }) });
    await render(<LiveTrackingHomeControls onOpenLocation={onOpenLocation} />);
    expect(screen.queryByText('Start sharing for today')).toBeNull();
    expect(screen.queryByText('Stop sharing for today')).toBeNull();
  });

  it('offers nothing in a build with live location off', async () => {
    await render(<LiveTrackingHomeControls onOpenLocation={onOpenLocation} />);
    expect(screen.queryByText('Start sharing for today')).toBeNull();
  });

  it('starts the day with the tracker’s own openDay', async () => {
    mockTracker = tracker();
    await render(<LiveTrackingHomeControls onOpenLocation={onOpenLocation} />);
    await fireEvent.press(screen.getByText('Start sharing for today'));
    expect(mockTracker.openDay).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Stop sharing for today')).toBeNull();
  });

  it('stops the day with the tracker’s own closeDay', async () => {
    mockTracker = tracker({ dayOpen: true, state: 'active', readingNow: true });
    await render(<LiveTrackingHomeControls onOpenLocation={onOpenLocation} />);
    await fireEvent.press(screen.getByText('Stop sharing for today'));
    expect(mockTracker.closeDay).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Turn location on')).toBeNull();
  });

  it('does not start while the company has it switched off', async () => {
    mockTracker = tracker({ status: status({ companyEnabled: false }), state: 'off_company' });
    await render(<LiveTrackingHomeControls onOpenLocation={onOpenLocation} />);
    await fireEvent.press(screen.getByText('Start sharing for today'));
    expect(mockTracker.openDay).not.toHaveBeenCalled();
    expect(screen.getByText('Your company has live location switched off.')).toBeTruthy();
  });

  it('sharing with location not allowed: offers the way to allow it', async () => {
    mockTracker = tracker({ dayOpen: true, state: 'active', readingNow: false });
    await render(<LiveTrackingHomeControls onOpenLocation={onOpenLocation} />);
    await fireEvent.press(screen.getByText('Turn location on'));
    expect(onOpenLocation).toHaveBeenCalledTimes(1);
  });
});
