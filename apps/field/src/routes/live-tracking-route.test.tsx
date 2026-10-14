import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { LiveTrackingStatus } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';

/**
 * `FE-W71` — the live location screen. The DRAFT notice is labelled as one; agreeing sends the
 * version that was SHOWN; a notice that changed underneath the rep is said so, not swallowed.
 */
// The tracker module reads the session; the screen under test is handed its tracker directly.
jest.mock('../session', () => ({
  useSession: () => ({ status: 'signed-in', session: null, role: 'mr' }),
}));
jest.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import { LiveTrackingScreen } from '../../app/live-tracking';
import type { LiveTracker } from '../tracking/tracker';

const NOTICE = '4e86b49c-05fc-4bd8-9f75-16e22a64309a';

/** A host element's style, merged — apps/field may not import `StyleSheet` (components live in ui). */
const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(5).filter(Boolean)) as Record<
    string,
    unknown
  >;

const status = (over: Partial<LiveTrackingStatus> = {}): LiveTrackingStatus => ({
  companyEnabled: true,
  intervalSeconds: 300,
  notice: { id: NOTICE, versionLabel: 'DRAFT 2026-10-13', body: 'The notice text.', isDraft: true },
  accepted: false,
  acceptedNoticeVersionId: null,
  withinWorkingHours: true,
  shiftEnd: '18:00:00',
  timeZone: 'Asia/Kolkata',
  today: '2026-10-13',
  serverTime: '2026-10-13T05:38:23+00:00',
  ...over,
});

const tracker = (over: Partial<LiveTracker> = {}): LiveTracker => ({
  status: status(),
  state: 'off_no_notice',
  line: {
    title: 'Live location is off until you read and accept the notice.',
    detail: null,
    tone: 'info',
  },
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

describe('app/live-tracking.tsx', () => {
  it('labels the draft notice as a draft, and shows the status line', async () => {
    await render(<LiveTrackingScreen tracker={tracker()} />);
    expect(screen.getByText('DRAFT — not approved by your company')).toBeTruthy();
    expect(screen.getByText('The notice text.')).toBeTruthy();
    expect(screen.getByText(/off until you read and accept/u)).toBeTruthy();
  });

  it('POSITIVE CONTROL: an approved notice carries no draft label', async () => {
    const approved = status({
      notice: { id: NOTICE, versionLabel: 'v1', body: 'Approved text.', isDraft: false },
    });
    await render(<LiveTrackingScreen tracker={tracker({ status: approved })} />);
    expect(screen.queryByText('DRAFT — not approved by your company')).toBeNull();
  });

  it('FE-W162: a Markdown notice is laid out — headings, joined paragraphs, bullets, no markers', async () => {
    const body = [
      '## Location sharing',
      '',
      'This is a **separate** notice from any',
      'other you have agreed to.',
      '',
      '* **Only during your working hours**.',
      '',
      '---',
      '',
      '**[ ] I have read this notice.**',
    ].join('\n');
    const shown = status({ notice: { id: NOTICE, versionLabel: 'v1', body, isDraft: false } });
    await render(<LiveTrackingScreen tracker={tracker({ status: shown })} />);
    expect(screen.getByText('Location sharing')).toBeTruthy();
    expect(
      screen.getByText('This is a separate notice from any other you have agreed to.'),
    ).toBeTruthy();
    // `FE-W191`: a bullet hangs — the mark and the words are drawn side by side, not as one string.
    expect(screen.getByText('Only during your working hours.')).toBeTruthy();
    expect(screen.getByText('•')).toBeTruthy();
    expect(screen.getByText('I have read this notice.')).toBeTruthy();
    expect(screen.queryByText(/\*\*|##|---|\[ \]/u)).toBeNull();
  });

  it('agreeing sends the version that was shown', async () => {
    const t = tracker();
    await render(<LiveTrackingScreen tracker={t} />);
    await fireEvent.press(screen.getByText('I have read this notice and agree'));
    expect(t.accept).toHaveBeenCalledWith(NOTICE);
  });

  it('a notice that changed while it was being read is said so', async () => {
    const t = tracker({ accept: jest.fn<LiveTracker['accept']>().mockResolvedValue('superseded') });
    await render(<LiveTrackingScreen tracker={t} />);
    await fireEvent.press(screen.getByText('I have read this notice and agree'));
    expect(await screen.findByText('The notice changed while you were reading it')).toBeTruthy();
  });

  it('accepted: the rep can start today, and withdraw', async () => {
    const t = tracker({ status: status({ accepted: true, acceptedNoticeVersionId: NOTICE }) });
    await render(<LiveTrackingScreen tracker={t} />);
    await fireEvent.press(screen.getByText('Start sharing for today'));
    expect(t.openDay).toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Withdraw my agreement'));
    expect(t.withdraw).toHaveBeenCalled();
  });

  it('with the company switch off, starting is refused on screen, with the reason', async () => {
    const t = tracker({
      status: status({ accepted: true, acceptedNoticeVersionId: NOTICE, companyEnabled: false }),
    });
    await render(<LiveTrackingScreen tracker={t} />);
    expect(screen.getByText('Your company has live location switched off.')).toBeTruthy();
  });
  it('FE-W191: Start and Stop are the same primary button, so the screen does not jump', async () => {
    const accepted = status({ accepted: true, acceptedNoticeVersionId: NOTICE });
    const { rerender } = await render(
      <LiveTrackingScreen tracker={tracker({ status: accepted, dayOpen: false })} />,
    );
    const fill = (label: string): unknown =>
      flat(screen.getByRole('button', { name: label }).props['style'])['backgroundColor'];
    const started = fill('Start sharing for today');
    await rerender(<LiveTrackingScreen tracker={tracker({ status: accepted, dayOpen: true })} />);
    expect(fill('Stop sharing for today')).toBe(started);
    expect(started).toBe(tokens.color.accent);
  });

  it('FE-W191: an accepted notice is said as done, in the success pill', async () => {
    const accepted = status({ accepted: true, acceptedNoticeVersionId: NOTICE });
    await render(<LiveTrackingScreen tracker={tracker({ status: accepted })} />);
    // The Badge names itself for a screen reader; its fill is the success wash.
    const pill = screen.getByLabelText('You have accepted this notice.');
    expect(flat(pill.props['style'])['backgroundColor']).toBe(tokens.color.successFill);
  });

  it('FE-W188: draws the Back control when given one', async () => {
    const onBack = jest.fn();
    await render(<LiveTrackingScreen onBack={onBack} tracker={tracker()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
