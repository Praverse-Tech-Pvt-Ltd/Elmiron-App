import type { SettingRow } from '@fieldforce/ui';
import { LANGUAGES, languageStore, t } from '@fieldforce/ui/i18n';
import type { Language } from '@fieldforce/ui/i18n';

/**
 * C4's entries, transcribed from `docs/design/phase2-first-run-and-the-day.dc.html`.
 *
 * **What is deliberately missing: the data-usage figures.** C4 opens with "84 MB of
 * your plan · Audio 52 MB · Everything else 20 MB". Nothing in this app measures the
 * phone's network usage and nothing in the contract reports it, so those numbers have
 * no source. They are also the numbers most likely to be believed — an MR deciding
 * whether to turn WiFi-only on reads them first — which makes them the worst
 * candidates for a plausible-looking guess. `FE-W137` measures ONE narrower thing —
 * this app's own uploads over mobile data — and the Mobile data screen shows it under
 * that name, never as "your plan".
 *
 * **WiFi-only and the 100 MB note now govern something** (`FE-W135`–`FE-W139`), so both
 * rows are `available` and open the Mobile data screen. WiFi-only ships *on*, as the
 * design said: "audio is 62% of the bill and the MR didn't choose to generate it".
 *
 * **Consent language is separate from app language on purpose** — the design calls
 * that a product decision as much as a design one. The consent screen is what the
 * *doctor* reads, and the doctor's language has nothing to do with the language the
 * MR set their own interface to. Keeping them as two rows preserves that.
 */
export interface SettingsNavigation {
  readonly onOpenMileage: () => void;
  readonly onOpenDayEnd: () => void;
  /** `FE-W161`. Present only where the step applies (Android); absent, there is no battery row. */
  readonly onOpenBattery?: () => void;
  readonly onOpenTransparency: () => void;
  readonly onOpenLocation: () => void;
  /** `FE-W139`. The Mobile data screen, behind both "Your data" rows. */
  readonly onOpenDataSettings: () => void;
  /**
   * FE-D15. Present only when `assistantEnabled`. Absent, there is no assistant row, so a
   * build with the flag off carries no trace of it.
   */
  readonly onOpenAssistant?: () => void;
  /** FE-D17. Present only when `practiceEnabled`; absent, there is no practice row. */
  readonly onOpenPractice?: () => void;
  /** W2-C C / `BE-W160`. Present only when `productQaEnabled`; absent, there is no row. */
  readonly onOpenProductQa?: () => void;
  /** W2-F B. Present only when `learningEnabled`; absent, there is no row. */
  readonly onOpenLearning?: () => void;
  /** `FE-W71`. Present only when `liveTrackingEnabled`; absent, there is no row. */
  readonly onOpenLiveTracking?: () => void;
  /** `FE-W142`. Switch the app to a language whose catalogue is complete, and keep it. */
  readonly onChooseLanguage: (language: Language) => void;
}

/**
 * `FE-W142` — one row per language, each named in its own script.
 *
 * The one in use is `chosen`. A complete one is `available` and switches the app. An incomplete
 * one is SHOWN, so the rep and the client can see it is coming and how far the translators have
 * got, but it is `not-yet` and cannot be pressed: the switch never offers a translation that does
 * not exist. It becomes pressable the moment its file is full, with no change here.
 */
const languageRows = (nav: SettingsNavigation): SettingRow[] =>
  LANGUAGES.map((language) => {
    const detail = language.code === 'en' ? '' : language.englishName;
    if (language.code === languageStore.current()) {
      return { id: `language-${language.code}`, title: language.name, detail, state: 'chosen' };
    }
    if (languageStore.selectable(language.code)) {
      return {
        id: `language-${language.code}`,
        title: language.name,
        detail,
        state: 'available',
        onPress: () => {
          nav.onChooseLanguage(language.code);
        },
      };
    }
    const { done, total } = languageStore.progress(language.code);
    return {
      id: `language-${language.code}`,
      title: language.name,
      detail,
      state: 'not-yet',
      note: t('settings.languageWaiting', { language: language.englishName, done, total }),
    };
  });

export const settingsGroups = (
  nav: SettingsNavigation,
): readonly { heading: string; rows: readonly SettingRow[] }[] => [
  {
    heading: t('settings.groupWork'),
    rows: [
      {
        id: 'mileage',
        title: t('settings.mileage'),
        detail: t('settings.mileageDetail'),
        state: 'available',
        onPress: nav.onOpenMileage,
      },
      {
        id: 'day-end',
        // B7. Reachable from Today once the day is done, and from here at any hour,
        // because the question it answers — "is this app still recording me" — is
        // one an MR is allowed to ask on a Sunday.
        title: t('settings.dayEnd'),
        detail: t('settings.dayEndDetail'),
        state: 'available',
        onPress: nav.onOpenDayEnd,
      },
      ...(nav.onOpenAssistant === undefined
        ? []
        : [
            {
              id: 'assistant',
              title: t('settings.assistant'),
              detail: t('settings.assistantDetail'),
              state: 'available' as const,
              onPress: nav.onOpenAssistant,
            },
          ]),
      ...(nav.onOpenPractice === undefined
        ? []
        : [
            {
              id: 'practice',
              title: t('settings.practice'),
              detail: t('settings.practiceDetail'),
              state: 'available' as const,
              onPress: nav.onOpenPractice,
            },
          ]),
      ...(nav.onOpenProductQa === undefined
        ? []
        : [
            {
              id: 'product-qa',
              title: t('settings.productQa'),
              detail: t('settings.productQaDetail'),
              state: 'available' as const,
              onPress: nav.onOpenProductQa,
            },
          ]),
      ...(nav.onOpenLearning === undefined
        ? []
        : [
            {
              id: 'learning',
              title: t('settings.learning'),
              detail: t('settings.learningDetail'),
              state: 'available' as const,
              onPress: nav.onOpenLearning,
            },
          ]),
    ],
  },
  {
    heading: t('settings.groupData'),
    rows: [
      {
        id: 'wifi-only',
        title: t('settings.wifiOnly'),
        detail: t('settings.wifiOnlyDetail'),
        state: 'available',
        onPress: nav.onOpenDataSettings,
      },
      {
        id: 'warn-over',
        title: t('settings.warnOver'),
        detail: t('settings.warnOverDetail'),
        state: 'available',
        onPress: nav.onOpenDataSettings,
      },
    ],
  },
  {
    heading: t('settings.groupLanguage'),
    rows: [
      ...languageRows(nav),
      {
        // `FE-W148`. Not a setting the rep makes: the DOCTOR chooses, on the consent screen, among
        // the notices the company has published (`consent_text_versions`, by language). Said as a
        // fact rather than as "coming later", because nothing here will ever switch it -- an
        // approved notice in Hindi or Marathi is what makes it appear.
        id: 'consent-language',
        title: t('settings.consentLanguage'),
        detail: t('settings.consentLanguageDetail'),
        state: 'info',
      },
    ],
  },
  {
    heading: t('settings.groupPhone'),
    rows: [
      ...(nav.onOpenLiveTracking === undefined
        ? []
        : [
            {
              id: 'live-tracking',
              title: t('settings.liveLocation'),
              detail: t('settings.liveLocationDetail'),
              state: 'available' as const,
              onPress: nav.onOpenLiveTracking,
            },
          ]),
      {
        id: 'location',
        title: t('settings.location'),
        detail: t('settings.locationDetail'),
        state: 'available',
        onPress: nav.onOpenLocation,
      },
      ...(nav.onOpenBattery === undefined
        ? []
        : [
            {
              id: 'battery',
              title: t('settings.battery'),
              // C4 draws "All 3 set correctly" here. The done-marks now persist, so the
              // count is finally *available* — it is still absent because this module is a
              // pure list and reading it would make every settings row wait on storage.
              // A row that needs live state should take it as a prop rather than fetch.
              detail: t('settings.batteryDetail'),
              state: 'available' as const,
              onPress: nav.onOpenBattery,
            },
          ]),
      {
        id: 'transparency',
        title: t('settings.transparency'),
        detail: t('settings.transparencyDetail'),
        state: 'available',
        onPress: nav.onOpenTransparency,
      },
    ],
  },
];
