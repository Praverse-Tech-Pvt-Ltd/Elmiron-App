import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Figure, Heading, Label, Secondary, Title } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { Screen } from './Screen';
import { Spinner } from './Spinner';
import { SyncQueueIndicator } from './SyncQueueIndicator';
import { TextField } from './TextField';
import type { SyncQueueState } from './SyncQueueIndicator';
import { FadeIn } from './FadeIn';
import { useT } from './i18n';

/**
 * Phase 2 B7 — the day is over and nothing is running.
 *
 * C11's note is the ordering rule and it is followed literally: **the stop
 * confirmation outranks the day's numbers.** An MR who is not sure whether
 * tracking stopped kills the app from Recents, and an app killed from Recents is
 * an app that is off tomorrow morning too. So the first card on this screen is the
 * answer to "is it still watching me", the day's totals come after it, and the
 * totals are never allowed to push the confirmation off the first screenful.
 *
 * **What this screen confirms is stronger than what B7 draws, not weaker.** B7
 * shows location being switched off at 18:22, which implies it was on until then.
 * `fe-w3-spec.md` §4a settled that this app takes discrete fixes only — a position
 * is read on a check-in or check-out press and at no other moment, and there is no
 * background location at all. So "nothing is being recorded" is not a state the MR
 * entered at 18:22; it is true all day, between every press. The copy says that,
 * because a screen that announced a stop the app never needed would be teaching
 * the MR the app tracks them continuously — the precise belief the transparency
 * work exists to correct.
 *
 * **Three numbers B7 draws are not here, and none is missing for effort.**
 *
 * - **₹627.** The rupee figure needs a per-kilometre rate, which exists in no
 *   contract, endpoint or config this app can read. `MileageScreen` refuses to
 *   invent it and so does this screen; `rateNote` is required for the same reason
 *   its `rateNote` is.
 * - **"ran 9h 27m".** A duration wants a start and an end. Only the second is a
 *   server stamp on a completed day, and subtracting to produce a headline figure
 *   is the clock arithmetic `today/plan.ts` rules out. The two server timestamps
 *   are shown instead, which says the same thing and asserts nothing the server
 *   did not.
 * - **"6.2 MB data used today".** Nothing in this app measures its own network
 *   use. A figure here would be decoration on the one screen whose entire claim is
 *   that its numbers are the honest ones.
 */
/**
 * `FE-W80` / `BE-W190` — the working day as the SERVER records it, and the one act on it.
 *
 * Every line is the caller's: this component decides nothing about whether the day is open,
 * ending or ended. It draws the record and the button. Null hides the card -- no server day to
 * read, so nothing honest to say about it.
 */
export interface DayEndWorkDay {
  /** "Your day is open — started 09:12", "Ended at 18:05. The server has it." */
  readonly title: string;
  readonly detail: string | null;
  /**
   * `refused`: the server said no to the last attempt, and `detail` says why and what to do.
   * Drawn as a critical banner, because a refusal the rep scrolls past is a day they think ended.
   */
  readonly tone: 'plain' | 'waiting' | 'done' | 'refused';
  /** The optional note for the manager. Null once the day is ending or ended. */
  readonly note: { readonly value: string; readonly onChange: (value: string) => void } | null;
  /**
   * "End my day". Null when there is nothing to press. `blockedBy` is the reason it cannot be
   * pressed yet -- a disabled button always says why. `FE-W180`: drawn in the screen's pinned
   * footer, not in the card.
   */
  readonly action: {
    readonly label: string;
    readonly onPress: () => void;
    readonly busy: boolean;
    readonly blockedBy: string | null;
  } | null;
}

export interface DayEndScreenProps {
  /** "Thursday" — the caller formats it; the device locale is the caller's problem. */
  readonly dayLabel: string;
  /**
   * "First check-in 08:55", or null before the day's first. A server stamp, sliced
   * by the caller — never a device clock.
   */
  readonly firstCaptureLabel: string | null;
  /** "Last check-out 18:22", or null when the day recorded no position at all. */
  readonly lastCaptureLabel: string | null;
  /**
   * The standing truth about when this app reads a position. Required: the card it
   * sits in is the reason the screen exists, and a confirmation with nothing under
   * it is a claim the MR has to take on trust.
   */
  readonly captureNote: string;
  /**
   * FE-D2 7. **Null means UNKNOWN, and unknown is not zero.** The day is still loading, or it
   * could not be fetched. It used to arrive as 0, and `done + notMet === planned` read 0 of 0 as
   * "you went to all of them". A real zero (nothing planned) is 0, and says so plainly.
   */
  readonly planned: number | null;
  readonly done: number | null;
  /**
   * **MR-12 D3. Visits attended where the doctor was not available.**
   *
   * The copy on this screen used to claim SUCCESS -- "2 of 3 visits done", "That's the
   * day done", "Everything on the plan is complete." An MR who drove to three clinics and
   * found three doctors in theatre did their whole job and got congratulated for a day
   * they would describe as wasted. Worse, `done` counted only `completed`, so the same MR
   * read "0 of 3" -- the app telling them they had achieved nothing.
   *
   * The screens now claim ATTENDANCE, which is the thing the MR controls and the thing
   * the record actually proves. `not_met` is surfaced plainly and never as a shortfall:
   * it is attributed to the territory or the doctor and never scored against the MR, which
   * is the term the MR-11 C5 decision was taken on.
   */
  readonly notMet: number | null;
  /**
   * "48.2 km" from the server's metres (a real zero is "0.0 km"), or null when it is UNKNOWN —
   * still loading, or the mileage fetch failed (FE-D3 B4).
   */
  readonly distanceLabel: string | null;
  /** Why there is no rupee figure. Required — see the note above. */
  readonly rateNote: string;
  readonly sync: SyncQueueState;
  readonly onOpenQueue: () => void;
  /** C10/A9. The way to check every word of this screen against the record. */
  readonly onOpenTransparency: () => void;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
  /** `FE-W80`. The working day and "End my day". Omitted or null: the card is not drawn. */
  readonly workDay?: DayEndWorkDay | null;
}

const styles = StyleSheet.create({
  head: { gap: tokens.space.xxs },
  stopLines: { gap: tokens.space.xs },
  figureRow: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space.sm },
  stamps: { gap: tokens.space.xxs },
});

export const DayEndScreen = ({
  dayLabel,
  firstCaptureLabel,
  lastCaptureLabel,
  captureNote,
  planned,
  notMet,
  done,
  distanceLabel,
  rateNote,
  sync,
  onOpenQueue,
  onOpenTransparency,
  loading = false,
  failure = null,
  workDay = null,
}: DayEndScreenProps): ReactNode => {
  const { t } = useT();
  if (failure !== null) {
    return (
      <Screen scrollable>
        <Title>{dayLabel}</Title>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </Screen>
    );
  }

  const action = workDay?.action ?? null;
  /*
    `FE-W180`. The screen's actions are PINNED in its footer, in the reach zone and above the
    keyboard while the note is being written, as Today's and the visit's are. They sat after a
    `flex: 1` spacer, which does nothing inside a scroll view — "End my day" was at the bottom of
    the working-day card and "See everything" at the end of the scroll. The primary comes last,
    nearest the thumb, as on Today.
  */
  const footer = (
    <>
      {/* FE-D7 4. Secondary, as B7 draws it: the day is over, and nothing here is the next step. */}
      <Button label={t('dayEnd.seeEverything')} onPress={onOpenTransparency} variant="secondary" />
      {action === null ? null : action.blockedBy === null ? (
        <Button
          label={action.label}
          loading={action.busy}
          loadingLabel={t('dayEnd.ending')}
          onPress={action.onPress}
        />
      ) : (
        <Button disabled label={action.label} note={action.blockedBy} onPress={action.onPress} />
      )}
    </>
  );

  return (
    <Screen scrollable footer={footer}>
      <View style={styles.head}>
        <Title>{t('dayEnd.title', { day: dayLabel })}</Title>
      </View>

      {/*
        C11's ordering, enforced by position: the stop confirmation is the first
        thing rendered and everything else follows it. This is also the screen's one
        hero card — §05 allows exactly one, and this is what it is for.
      */}
      {/* FE-W102. The day's summary settles in top to bottom, the confirmation first. */}
      <FadeIn index={0}>
        <Card tone="hero">
          <View style={styles.stopLines}>
            <Heading>{t('dayEnd.nothingRecorded')}</Heading>
            <BodyText>{captureNote}</BodyText>
          </View>
          {firstCaptureLabel === null && lastCaptureLabel === null ? null : (
            <View style={styles.stamps}>
              {firstCaptureLabel === null ? null : <Label>{firstCaptureLabel}</Label>}
              {lastCaptureLabel === null ? null : <Label>{lastCaptureLabel}</Label>}
            </View>
          )}
        </Card>
      </FadeIn>

      {/*
        Under the confirmation, never over it, and non-blocking: a day already
        finished is not made more finished by a spinner in front of it.
      */}
      {loading ? <Spinner label={t('dayEnd.loading')} /> : null}

      {/*
        FE-D7 4. The design's "Your Thursday". The route passes "Today", and prefixing that gave
        "Your Today"; the title above already names the day.
      */}
      <Label muted>{t('dayEnd.yourDay')}</Label>

      <FadeIn index={1}>
        <Card>
          <Label muted>{t('dayEnd.visits')}</Label>
          {planned === null || done === null || notMet === null ? (
            // FE-D2 7. Unknown. While loading the spinner above already says so; once loading has
            // finished and the counts are still absent, the day could not be fetched.
            loading ? null : (
              <BodyText>{t('dayEnd.visitsUnavailable')}</BodyText>
            )
          ) : (
            <View style={styles.figureRow}>
              <Figure>{t('common.nOfM', { n: done + notMet, m: planned })}</Figure>
              {/* `FE-W178`. A figure's caption is `Secondary`, as Today's "visits attended" is. */}
              <Secondary>
                {planned === 0
                  ? t('dayEnd.nothingPlanned')
                  : done + notMet === planned
                    ? t('dayEnd.allOfThem')
                    : t('dayEnd.visitsAttended')}
              </Secondary>
            </View>
          )}
          {notMet === null || notMet === 0 ? null : (
            <Label muted>{t('dayEnd.notMet', { count: notMet })}</Label>
          )}
        </Card>
      </FadeIn>

      <FadeIn index={2}>
        <Card>
          <Label muted>{t('dayEnd.onYourClaim')}</Label>
          {distanceLabel === null ? (
            // FE-D3 B4. Null is UNKNOWN: still loading (the spinner above says so) or the mileage
            // fetch failed. A real zero arrives as a figure. This used to read "No distance yet. It
            // appears once you have checked into more than one visit" — a false reason for a
            // fetch that had failed.
            loading ? null : (
              <BodyText>{t('dayEnd.distanceUnavailable')}</BodyText>
            )
          ) : (
            <View style={styles.figureRow}>
              <Figure>{distanceLabel}</Figure>
            </View>
          )}
          <Label muted>{rateNote}</Label>
        </Card>
      </FadeIn>

      {workDay === null ? null : <WorkDayCard workDay={workDay} />}

      <SyncQueueIndicator onPress={onOpenQueue} state={sync} />
    </Screen>
  );
};

/**
 * The working day's card. Under the totals, never above the stop confirmation (C11): ending the day
 * changes the record, not whether the phone is reading a position -- it never was between presses.
 *
 * `FE-W80` gave ending the day a record (`BE-W190`). Its button is the screen's pinned primary
 * (`FE-W180`); this card says where the day stands and holds the note that goes with it. There is
 * still no "start day tomorrow" button: capture is per press, so that would switch on nothing.
 */
const WorkDayCard = ({ workDay }: { readonly workDay: DayEndWorkDay }): ReactNode => {
  const { t } = useT();
  const { note } = workDay;
  return (
    <Card>
      <Label muted>{t('dayEnd.workingDay')}</Label>
      {workDay.tone === 'refused' ? (
        <Banner
          tone="critical"
          title={workDay.title}
          {...(workDay.detail === null ? {} : { detail: workDay.detail })}
        />
      ) : (
        <View style={styles.stopLines}>
          <Heading>{workDay.title}</Heading>
          {workDay.detail === null ? null : <BodyText>{workDay.detail}</BodyText>}
        </View>
      )}
      {note === null ? null : (
        <TextField
          help={t('dayEnd.noteHelp')}
          label={t('dayEnd.noteLabel')}
          multiline
          onChangeText={note.onChange}
          value={note.value}
        />
      )}
    </Card>
  );
};
