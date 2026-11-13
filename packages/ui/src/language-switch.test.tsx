import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';

/**
 * `FE-W141` — choosing a language repaints what is already on screen, with no remount.
 *
 * The shipped Hindi file is empty, so it cannot be chosen; this suite stands in a COMPLETE one
 * (every English value with "हि " in front, placeholders intact) to show what happens the day the
 * translators' file arrives full. Nothing but the file differs.
 */
jest.mock('./i18n/hi.json', () => {
  const english = jest.requireActual<Record<string, string>>('./i18n/en.json');
  return Object.fromEntries(Object.entries(english).map(([key, value]) => [key, `हि ${value}`]));
});

import { languageStore } from './i18n';
import { SettingsScreen } from './SettingsScreen';
import { TodayScreen } from './TodayScreen';

afterEach(async () => {
  await act(() => {
    languageStore.choose('en');
  });
});

describe('a complete language, chosen while a screen is showing', () => {
  it('repaints Today in place — title, sync line and counts', async () => {
    await render(
      <TodayScreen
        dayLabel="Today"
        startedLabel={null}
        planned={0}
        done={0}
        notMet={0}
        next={null}
        sync={{ kind: 'waiting', count: 3 }}
        onOpenQueue={() => undefined}
      />,
    );
    expect(screen.getByText('Nothing planned for today')).toBeTruthy();
    expect(screen.getByText('3 waiting · no signal')).toBeTruthy();

    await act(() => {
      expect(languageStore.choose('hi')).toBe(true);
    });

    expect(screen.getByText('हि Nothing planned for today')).toBeTruthy();
    expect(screen.getByText('हि 3 waiting · no signal')).toBeTruthy();
    expect(screen.queryByText('Nothing planned for today')).toBeNull();
  });

  it('repaints Settings, and goes back to English when English is chosen', async () => {
    await render(<SettingsScreen groups={[]} />);
    await act(() => {
      languageStore.choose('hi');
    });
    expect(screen.getByText('हि Me')).toBeTruthy();
    await act(() => {
      languageStore.choose('en');
    });
    expect(screen.getByText('Me')).toBeTruthy();
  });

  it('an incomplete language (Marathi, empty) is refused and nothing changes', async () => {
    await render(<SettingsScreen groups={[]} />);
    await act(() => {
      expect(languageStore.choose('mr')).toBe(false);
    });
    expect(screen.getByText('Me')).toBeTruthy();
  });
});
