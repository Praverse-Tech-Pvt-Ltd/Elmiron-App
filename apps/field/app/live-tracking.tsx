import { useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import {
  Badge,
  Banner,
  BodyText,
  Button,
  Card,
  Heading,
  NoticeText,
  Screen,
  Title,
  t,
  useLanguage,
} from '@fieldforce/ui';
import type { TextKey } from '@fieldforce/ui';
import { liveTrackingEnabled } from '../src/features';
import { noticeBlocks } from '../src/tracking/notice-blocks';
import { useBack } from '../src/navigation/back';
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
 *
 * **`FE-W155`. The screen's own words are in the catalogue; the notice is not.** The notice's
 * version label and body are the server's published text (`status.notice`), shown exactly as
 * published and never through `t()`: it is a privacy notice, legal wording that only an approved
 * version may change — English-only, like consent. Everything around it is the app's.
 */
type Outcome = 'withdraw-failed' | 'superseded' | 'accept-failed';

const OUTCOME: Readonly<Record<Outcome, { readonly title: TextKey; readonly detail: TextKey }>> = {
  'withdraw-failed': {
    title: 'liveTracking.withdrawFailed',
    detail: 'liveTracking.withdrawFailedDetail',
  },
  superseded: { title: 'liveTracking.superseded', detail: 'liveTracking.supersededDetail' },
  'accept-failed': { title: 'liveTracking.agreeFailed', detail: 'liveTracking.agreeFailedDetail' },
};

export const LiveTrackingScreen = ({
  tracker,
  onBack,
}: {
  readonly tracker: LiveTracker;
  /** `FE-W188`. The screen's Back control. */
  readonly onBack?: () => void;
}): ReactNode => {
  useLanguage();
  // `FE-W155`. Which outcome, not its sentences: they are read at render.
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const { status, line, dayOpen, busy } = tracker;
  const notice = status?.notice ?? null;

  return (
    <Screen scrollable {...(onBack === undefined ? {} : { onBack })}>
      <Title>{t('settings.liveLocation')}</Title>
      <Banner
        tone={line.tone}
        title={line.title}
        {...(line.detail === null ? {} : { detail: line.detail })}
      />
      {outcome === null ? null : (
        <Banner
          tone="critical"
          title={t(OUTCOME[outcome].title)}
          detail={t(OUTCOME[outcome].detail)}
        />
      )}

      {status === null ? null : status.companyEnabled ? null : (
        <BodyText muted>{t('liveTracking.companyOff')}</BodyText>
      )}

      {notice === null ? (
        <BodyText muted>{t('liveTracking.noNotice')}</BodyText>
      ) : (
        <Card>
          {notice.isDraft ? (
            <Banner
              tone="attention"
              title={t('liveTracking.draftTitle')}
              detail={t('liveTracking.draftDetail')}
            />
          ) : null}
          {/* FE-W155: the published notice — legal wording, English-only like consent — not in the catalogue. */}
          <Heading>{notice.versionLabel}</Heading>
          {/*
            `FE-W162`: laid out as written (headings, paragraphs, bullets), every word kept.
            `FE-W191`: in `NoticeText`, so a section heading has air above it and a bullet hangs.
          */}
          <NoticeText blocks={noticeBlocks(notice.body)} />
        </Card>
      )}

      {notice === null || status === null ? null : status.accepted ? (
        <>
          {/*
            `FE-W191`. Said as the done thing it is — the success pill — not as a muted caption that
            read like small print under the notice.
          */}
          <Badge label={t('liveTracking.accepted')} tone="success" />
          {/*
            `FE-W191`. Start and Stop are the same button in two states, so they are the same size:
            Stop was a secondary (52pt) where Start was a primary (60pt), and Withdraw below jumped
            21px each time sharing was switched. Stopping is as much the screen's one action as
            starting — live location must be as easy to stop as to start.
          */}
          {dayOpen ? (
            <Button
              label={t('liveTracking.stop')}
              onPress={() => {
                void tracker.closeDay();
              }}
            />
          ) : status.companyEnabled ? (
            <Button
              label={t('liveTracking.start')}
              onPress={() => {
                void tracker.openDay();
              }}
            />
          ) : (
            <Button
              label={t('liveTracking.start')}
              disabled
              note={t('liveTracking.switchedOff')}
              onPress={() => undefined}
            />
          )}
          <Button
            label={t('liveTracking.withdraw')}
            variant="destructive"
            loading={busy}
            onPress={() => {
              setOutcome(null);
              void tracker.withdraw().then((ok) => {
                if (ok) void tracker.closeDay();
                else setOutcome('withdraw-failed');
              });
            }}
          />
        </>
      ) : (
        <Button
          label={t('liveTracking.agree')}
          loading={busy}
          onPress={() => {
            setOutcome(null);
            void tracker.accept(notice.id).then((result) => {
              if (result === 'superseded') setOutcome('superseded');
              else if (result === 'failed') setOutcome('accept-failed');
            });
          }}
        />
      )}
    </Screen>
  );
};

export default function LiveTrackingRoute(): ReactNode {
  const tracker = useLiveTracker();
  // Called before the early return: a hook is never conditional.
  const back = useBack();
  if (!liveTrackingEnabled || tracker === null) return <Redirect href="/home" />;
  return <LiveTrackingScreen onBack={back} tracker={tracker} />;
}
