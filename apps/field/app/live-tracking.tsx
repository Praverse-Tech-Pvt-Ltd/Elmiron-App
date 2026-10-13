import { useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { Banner, BodyText, Button, Card, Heading, Label, Screen, Title } from '@fieldforce/ui';
import { liveTrackingEnabled } from '../src/features';
import { useLiveTracker } from '../src/tracking/tracker';
import type { LiveTracker } from '../src/tracking/tracker';

/**
 * `FE-W71` — the live location notice, and the rep's controls over it.
 *
 * Reached from Me ("Live location") and from the status line. Everything on it is the server's: the
 * notice text and whether it is a draft, whether the company has switched live location on, whether
 * the rep's acceptance is of the current version. The rep can accept, withdraw, and start or stop
 * sharing for today; each is a call the server decides (`20261013000100_live_tracking`).
 *
 * **A DRAFT is labelled as one, above the text and not inside it.** Until the company loads and
 * approves its own notice, the text shown is engineering's draft with its blanks still blank — shown
 * so the feature can be tried, never passed off as the company's word.
 */
export const LiveTrackingScreen = ({ tracker }: { readonly tracker: LiveTracker }): ReactNode => {
  const [outcome, setOutcome] = useState<{ title: string; detail: string } | null>(null);
  const { status, line, dayOpen, busy } = tracker;
  const notice = status?.notice ?? null;

  return (
    <Screen scrollable>
      <Title>Live location</Title>
      <Banner
        tone={line.tone}
        title={line.title}
        {...(line.detail === null ? {} : { detail: line.detail })}
      />
      {outcome === null ? null : (
        <Banner tone="critical" title={outcome.title} detail={outcome.detail} />
      )}

      {status === null ? null : status.companyEnabled ? null : (
        <BodyText muted>
          Your company has not switched live location on. You can read the notice now; nothing is
          shared until your company switches it on and you start it.
        </BodyText>
      )}

      {notice === null ? (
        <BodyText muted>There is no notice to read yet.</BodyText>
      ) : (
        <Card>
          {notice.isDraft ? (
            <Banner
              tone="attention"
              title="DRAFT — not approved by your company"
              detail="This is a draft notice, shown so live location can be tried. Your company has not approved it, and parts of it are still blank."
            />
          ) : null}
          <Heading>{notice.versionLabel}</Heading>
          <BodyText>{notice.body}</BodyText>
        </Card>
      )}

      {notice === null || status === null ? null : status.accepted ? (
        <>
          <Label muted>You have accepted this notice.</Label>
          {dayOpen ? (
            <Button
              label="Stop sharing for today"
              variant="secondary"
              onPress={() => {
                void tracker.closeDay();
              }}
            />
          ) : status.companyEnabled ? (
            <Button
              label="Start sharing for today"
              onPress={() => {
                void tracker.openDay();
              }}
            />
          ) : (
            <Button
              label="Start sharing for today"
              disabled
              note="Your company has live location switched off."
              onPress={() => undefined}
            />
          )}
          <Button
            label="Withdraw my agreement"
            variant="destructive"
            loading={busy}
            onPress={() => {
              setOutcome(null);
              void tracker.withdraw().then((ok) => {
                if (ok) void tracker.closeDay();
                else
                  setOutcome({
                    title: 'Your withdrawal did not reach your company',
                    detail: 'Nothing changed. Try again when you have signal.',
                  });
              });
            }}
          />
        </>
      ) : (
        <Button
          label="I have read this notice and agree"
          loading={busy}
          onPress={() => {
            setOutcome(null);
            void tracker.accept(notice.id).then((result) => {
              if (result === 'superseded') {
                setOutcome({
                  title: 'The notice changed while you were reading it',
                  detail: 'The new version is shown above. Read it before you agree.',
                });
              } else if (result === 'failed') {
                setOutcome({
                  title: 'Your agreement did not reach your company',
                  detail: 'Nothing was recorded. Try again when you have signal.',
                });
              }
            });
          }}
        />
      )}
    </Screen>
  );
};

export default function LiveTrackingRoute(): ReactNode {
  const tracker = useLiveTracker();
  if (!liveTrackingEnabled || tracker === null) return <Redirect href="/home" />;
  return <LiveTrackingScreen tracker={tracker} />;
}
