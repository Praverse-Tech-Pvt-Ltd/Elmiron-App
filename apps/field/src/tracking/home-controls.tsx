import type { ReactNode } from 'react';
import { Button, useT } from '@fieldforce/ui';
import { useLiveTracker } from './tracker';

/**
 * `FE-W220` — start and stop live location from Today, without opening the notice screen.
 *
 * Today already says what live location is doing (`LiveTrackingStatusLine`); stopping it was two
 * screens away, on Live location. A rep who goes off duty should be able to stop sharing where the
 * app opens, as easily as it was started.
 *
 * **Nothing here widens what is shared.** The buttons are the tracker's own `openDay` and `closeDay`,
 * the same two the Live location screen calls, and they appear only AFTER the rep has accepted the
 * current notice: before that the only way in is still the notice itself, through the status line's
 * link. Every other rule (the company switch, working hours, the server's refusals) decides as before.
 *
 * The second button is for the one thing that silently stops sharing: location not allowed for the
 * app. `state` is `active` while `readingNow` is false exactly then, and the button opens the screen
 * that asks for the permission (`/onboarding/location`), the same one Me links to.
 */
export const LiveTrackingHomeControls = ({
  onOpenLocation,
}: {
  readonly onOpenLocation: () => void;
}): ReactNode => {
  const { t } = useT();
  const tracker = useLiveTracker();
  if (tracker === null) return null;
  const { status, dayOpen, state, readingNow } = tracker;
  if (status === null || status.notice === null || !status.accepted) return null;
  return (
    <>
      {dayOpen ? (
        <Button
          label={t('liveTracking.stop')}
          variant="secondary"
          onPress={() => {
            void tracker.closeDay();
          }}
        />
      ) : status.companyEnabled ? (
        <Button
          label={t('liveTracking.start')}
          variant="secondary"
          onPress={() => {
            void tracker.openDay();
          }}
        />
      ) : (
        <Button
          label={t('liveTracking.start')}
          variant="secondary"
          disabled
          note={t('liveTracking.switchedOff')}
          onPress={() => undefined}
        />
      )}
      {state === 'active' && !readingNow ? (
        <Button
          label={t('onboarding.turnLocationOn')}
          variant="secondary"
          onPress={onOpenLocation}
        />
      ) : null}
    </>
  );
};
