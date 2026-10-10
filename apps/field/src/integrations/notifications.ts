import { NOTIFICATION_TYPES } from '../onboarding/notifications';

/**
 * Notifications — the event model, the rep's preferences, deep links, and a mock adapter.
 *
 * **No notification SDK is installed and none is called.** Delivering a notification to a phone
 * needs Firebase credentials (operator question Q-3) and a dependency this repository asks about
 * before adding. What is here is everything that does not: which events exist (the four the
 * permission screen already names, `onboarding/notifications.ts`), whether the rep wants each,
 * where tapping one opens, and an adapter the real sender will implement.
 */
export type NotificationTypeId = (typeof NOTIFICATION_TYPES)[number]['id'];

export type NotificationEvent =
  | { readonly type: 'day-plan'; readonly planDate: string }
  | { readonly type: 'sync-outcome'; readonly itemId: string; readonly refused: boolean }
  | { readonly type: 'consent-outcome'; readonly visitId: string }
  | { readonly type: 'coaching'; readonly analysisId: string };

export type NotificationPreferences = Readonly<Record<NotificationTypeId, boolean>>;

/** Every type on until the rep turns one off -- the permission screen asked for all four. */
export const DEFAULT_PREFERENCES: NotificationPreferences = Object.fromEntries(
  NOTIFICATION_TYPES.map((type) => [type.id, true]),
);

/** Where tapping the notification opens, inside the app. Never a URL outside it. */
export const deepLinkFor = (event: NotificationEvent): string => {
  switch (event.type) {
    case 'day-plan':
      return '/beat-plan';
    case 'sync-outcome':
      return '/queue';
    case 'consent-outcome':
      return `/visit/${event.visitId}`;
    case 'coaching':
      return `/analysis/${event.analysisId}`;
  }
};

export interface NotificationAdapter {
  /** Shows one notification. The real adapter delivers through the platform; the mock records it. */
  readonly show: (title: string, event: NotificationEvent) => Promise<void>;
}

/**
 * Whether to show an event at all: the rep's preference for its type, and the day's cap
 * (`DAILY_CAP`, itself still a placeholder -- `DAILY_CAP_IS_UNSOURCED`).
 */
export const shouldShow = (
  event: NotificationEvent,
  preferences: NotificationPreferences,
  shownToday: number,
  dailyCap: number,
): boolean => preferences[event.type] === true && shownToday < dailyCap;

/** A mock adapter: records what would have been shown, for tests and for a build with no sender. */
export const createMockNotificationAdapter = (): NotificationAdapter & {
  readonly shown: readonly { readonly title: string; readonly link: string }[];
} => {
  const shown: { title: string; link: string }[] = [];
  return {
    shown,
    show: (title, event) => {
      shown.push({ title, link: deepLinkFor(event) });
      return Promise.resolve();
    },
  };
};
