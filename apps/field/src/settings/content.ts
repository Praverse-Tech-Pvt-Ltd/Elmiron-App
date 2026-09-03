import type { SettingRow } from '@fieldforce/ui';

/**
 * C4's entries, transcribed from `docs/design/phase2-first-run-and-the-day.dc.html`.
 *
 * **What is deliberately missing: the data-usage figures.** C4 opens with "84 MB of
 * your plan · Audio 52 MB · Everything else 20 MB". Nothing in this app measures
 * network usage and nothing in the contract reports it, so those numbers have no
 * source. They are also the numbers most likely to be believed — an MR deciding
 * whether to turn WiFi-only on reads them first — which makes them the worst
 * candidates for a plausible-looking guess.
 *
 * **Why WiFi-only is listed even though it does nothing yet.** The design's note is
 * that it ships *on*, because "audio is 62% of the bill and the MR didn't choose to
 * generate it". That default is a commitment worth recording before the upload path
 * is written, so the row is here and marked honestly rather than left out.
 *
 * **Consent language is separate from app language on purpose** — the design calls
 * that a product decision as much as a design one. The consent screen is what the
 * *doctor* reads, and the doctor's language has nothing to do with the language the
 * MR set their own interface to. Keeping them as two rows preserves that.
 */
export interface SettingsNavigation {
  readonly onOpenMileage: () => void;
  readonly onOpenDayEnd: () => void;
  readonly onOpenBattery: () => void;
  readonly onOpenTransparency: () => void;
  readonly onOpenLocation: () => void;
}

export const settingsGroups = (
  nav: SettingsNavigation,
): readonly { heading: string; rows: readonly SettingRow[] }[] => [
  {
    heading: 'Your work',
    rows: [
      {
        id: 'mileage',
        title: 'Mileage',
        detail: 'Distance on this month’s claim, day by day.',
        state: 'available',
        onPress: nav.onOpenMileage,
      },
      {
        id: 'day-end',
        // B7. Reachable from Today once the day is done, and from here at any hour,
        // because the question it answers — "is this app still recording me" — is
        // one an MR is allowed to ask on a Sunday.
        title: 'How today ended',
        detail: 'What was recorded, what was sent, and what is running now.',
        state: 'available',
        onPress: nav.onOpenDayEnd,
      },
    ],
  },
  {
    heading: 'Your data',
    rows: [
      {
        id: 'wifi-only',
        title: 'Send audio on WiFi only',
        detail: 'Recordings wait for WiFi. Everything else still sends.',
        state: 'not-yet',
      },
      {
        id: 'warn-over',
        title: 'Warn me over 100 MB',
        detail: 'A note on home, nothing stops working.',
        state: 'not-yet',
      },
    ],
  },
  {
    heading: 'Language',
    rows: [
      {
        id: 'app-language',
        title: 'App language',
        detail: 'The language you read.',
        state: 'not-yet',
      },
      {
        id: 'consent-language',
        title: 'Consent screen language',
        detail: 'What the doctor reads. Set separately from your own.',
        state: 'not-yet',
      },
    ],
  },
  {
    heading: 'This phone',
    rows: [
      {
        id: 'location',
        title: 'Location',
        detail: 'What it is for, and when it is taken.',
        state: 'available',
        onPress: nav.onOpenLocation,
      },
      {
        id: 'battery',
        title: 'Battery & autostart',
        // C4 draws "All 3 set correctly" here. The done-marks now persist, so the
        // count is finally *available* — it is still absent because this module is a
        // pure list and reading it would make every settings row wait on storage.
        // A row that needs live state should take it as a prop rather than fetch.
        detail: 'Keep check-ins and mileage working when the phone sleeps.',
        state: 'available',
        onPress: nav.onOpenBattery,
      },
      {
        id: 'transparency',
        title: 'What this app records',
        detail: 'Everything, before you ask.',
        state: 'available',
        onPress: nav.onOpenTransparency,
      },
    ],
  },
];
