import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type * as ReactModule from 'react';
import type * as UiModule from '@fieldforce/ui';

/**
 * FE-D4 1 — Coaching is hidden unless a flag turns it on.
 *
 * FE-D3 A3: the Coaching tab, the analysis screen and the reply screen show mock AI output that
 * nothing real produces, labelled "Written by the system from the transcript" — it could be taken
 * for working AI. Operator ruling: one flag, off by default. Off: the tab is not in the bar, and
 * the three routes are unreachable — a deep link sends the rep to Today. On: exactly as before.
 * No code is deleted.
 */

let mockCoachingEnabled = false;
jest.mock('../features', () => ({
  get coachingEnabled() {
    return mockCoachingEnabled;
  },
}));

// expo-router, observed. A `Tabs.Screen` whose `href` is null is not in the bar — expo-router's
// own rule for hiding a tab — so only the others render a marker.
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const ui = jest.requireActual<typeof UiModule>('@fieldforce/ui');
  const Tabs = ({ children }: { children: ReactNode }): ReactNode => children;
  Tabs.Screen = ({ name, options }: { name: string; options?: { href?: null } }): ReactNode =>
    options?.href === null ? null : React.createElement(ui.BodyText, null, `TAB ${name}`);
  return {
    Tabs,
    Redirect: ({ href }: { href: string }): ReactNode =>
      React.createElement(ui.BodyText, null, `redirect:${href}`),
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => ({
      id: '55555555-5555-4555-8555-555555555511',
      analysisId: '55555555-5555-4555-8555-555555555511',
    }),
  };
});

// Behind the flag, the screens read the mock and the store. Neither answers here: the point is
// only whether the screen MOUNTS (flag on) or redirects (flag off).
const mockGetAnalysis = jest.fn(() => new Promise(() => undefined));
const mockListAnalyses = jest.fn(() => new Promise(() => undefined));
// FE-D16 — the screens read the REAL functions now (`src/coaching/server.ts`), so that is what is
// observed. The question this suite asks is unchanged: mount (flag on) or redirect (flag off).
jest.mock('../coaching/server', () => ({
  readMyAnalysis: () => mockGetAnalysis(),
  listMyAnalyses: () => mockListAnalyses(),
  listConsentForVisit: jest.fn(() => new Promise(() => undefined)),
  respondToMyAnalysis: jest.fn(() => new Promise(() => undefined)),
}));
jest.mock('../coaching/recording-flag', () => ({
  loadRecordingEnabled: () => Promise.resolve(false),
}));
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({
    serverTime: '2026-09-20T06:00:00.000Z',
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    store: { visit: new Map(), doctor: new Map() },
    status: 'ready',
    failure: null,
  }),
}));

import TabsLayout from '../../app/(tabs)/_layout';
import Coaching from '../../app/(tabs)/coaching';
import AnalysisRoute from '../../app/analysis/[id]';
import ReplyRoute from '../../app/reply/[analysisId]';

beforeEach(() => {
  mockCoachingEnabled = false;
  mockGetAnalysis.mockClear();
  mockListAnalyses.mockClear();
});

describe('FE-D4 1 — flag OFF (the default)', () => {
  it('the tab bar has Today, Doctors and Me — and no Coaching', async () => {
    await render(<TabsLayout />);

    expect(screen.getByText('TAB home')).toBeTruthy();
    expect(screen.getByText('TAB doctors')).toBeTruthy();
    expect(screen.getByText('TAB me')).toBeTruthy();
    expect(screen.queryByText('TAB coaching')).toBeNull();
  });

  it('a deep link to an analysis goes home, and asks the mock for nothing', async () => {
    await render(<AnalysisRoute />);
    expect(screen.getByText('redirect:/home')).toBeTruthy();
    expect(mockGetAnalysis).not.toHaveBeenCalled();
  });

  it('a deep link to a reply goes home, and asks the mock for nothing', async () => {
    await render(<ReplyRoute />);
    expect(screen.getByText('redirect:/home')).toBeTruthy();
    expect(mockGetAnalysis).not.toHaveBeenCalled();
  });

  it('a deep link to the hidden Coaching tab goes home too', async () => {
    await render(<Coaching />);
    expect(screen.getByText('redirect:/home')).toBeTruthy();
  });
});

describe('FE-D4 1 — flag ON: exactly as before', () => {
  beforeEach(() => {
    mockCoachingEnabled = true;
  });

  it('the Coaching tab is in the bar', async () => {
    await render(<TabsLayout />);
    expect(screen.getByText('TAB coaching')).toBeTruthy();
  });

  it('the analysis, reply and Coaching screens mount and do not redirect', async () => {
    await render(<AnalysisRoute />);
    expect(screen.queryByText('redirect:/home')).toBeNull();
    expect(mockGetAnalysis).toHaveBeenCalled();
    mockGetAnalysis.mockClear();

    await render(<ReplyRoute />);
    expect(screen.queryByText('redirect:/home')).toBeNull();
    expect(mockGetAnalysis).toHaveBeenCalled();

    await render(<Coaching />);
    expect(screen.queryByText('redirect:/home')).toBeNull();
  });
});
