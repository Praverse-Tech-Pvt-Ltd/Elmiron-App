import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { Display, Figure, Heading, Label, Statement } from './Text';
import { Button } from './Button';
import { Screen } from './Screen';
import { SurfaceContext } from './surface';
import { useT } from './i18n';

/**
 * Phase 3 D7 — the MR's own voice note.
 *
 * **Hold to record, release to finish.** The design draws a hold control and the
 * reason is in its note: this is used in a corridor between visits, and a
 * tap-to-start / tap-to-stop pair leaves a recording running when the MR is
 * interrupted mid-thought. Holding cannot be left on by accident.
 *
 * **Dark ground, and the prompt is a question.** Both are the design's: the screen
 * is used in a corridor, and "What should I put in the report?" gives the MR
 * something to answer rather than a blank field to face.
 *
 * **No third party is in this recording, and the screen never implies one is.**
 * A voice note is the MR dictating to themselves — it needs no doctor's consent,
 * it fires on every visit including a declined one, and that is why a declined
 * visit still produces coaching signal. `onboarding/microphone.tsx` keeps the two
 * apart in as many words and this screen must not collapse them.
 *
 * **`FE-W190`. The controls sit in the pinned footer, where every screen's action is.** They were
 * inside the dark card, half-way up the screen, with "Start again" drawn before anything had been
 * recorded (QA 33). Now "Hold to record" is the bottom-most control — under the thumb, and in the
 * same place whatever else appears — and "Save this note" and "Start again" appear above it only
 * once there is a note to save or throw away.
 */
export interface VoiceNoteScreenProps {
  /** "Your note · Dr S. Iyer" — the caller formats it. */
  readonly subject: string;
  /** The question the MR is answering. */
  readonly prompt: string;
  /** What to cover, in one line. */
  readonly hint: string;
  /** "0:23" — elapsed, from the caller. */
  readonly elapsed: string;
  readonly recording: boolean;
  /** Called on press-in and press-out of the hold control. */
  readonly onHoldStart: () => void;
  readonly onHoldEnd: () => void;
  /** Discards what has been captured and starts over. */
  readonly onStartAgain: () => void;
  /** Present once something has been captured and not yet discarded. */
  readonly onSave?: () => void;
  readonly busy?: boolean;
  /**
   * What actually happened to the note, once it has been sent.
   *
   * Its own prop rather than a hard-coded "Sent" because the true sentence is not
   * that: the server answers a create with an upload session, and until the upload
   * path exists the audio is still only on this phone. A screen that said "sent"
   * over an unsent file would be the exact lie the sync queue was designed to
   * prevent.
   */
  readonly saved?: string | null;
  /** Why the microphone cannot open. Blocks the control entirely. */
  readonly blocked?: string | null;
  /**
   * `FE-W198`. The way to the phone's settings for this app, when `blocked` sends the rep there. A
   * banner that says "turn it on in Settings" and offers no way there leaves the rep to find it.
   */
  readonly onOpenSettings?: () => void;
  /** The microphone could not be opened. Replaces the screen: there is nothing to record with. */
  readonly failure?: { readonly title: string; readonly detail: string } | null;
  /**
   * FE-D2 6. What the last press produced when it failed. Shown above the recorder and never
   * instead of it, so "Start again" and "Save this note" stay reachable.
   */
  readonly actionFailure?: { readonly title: string; readonly detail: string } | null;
  /** `FE-W188`. The screen's Back control (`Screen`'s `onBack`). */
  readonly onBack?: () => void;
}

const styles = StyleSheet.create({
  dark: {
    backgroundColor: tokens.color.textPrimary,
    borderRadius: tokens.radius.card,
    padding: tokens.space.md,
    gap: tokens.space.md,
  },
  centre: { alignItems: 'center', gap: tokens.space.xs },
  foot: { gap: tokens.space.sm },
  hold: {
    minHeight: tokens.target.inVisit,
    borderRadius: tokens.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: tokens.space.sm,
    backgroundColor: tokens.color.sage,
    // `FE-W190`. An accent edge: on its own the pale sage read as a control switched off (QA 33).
    // The edge is the colour of every other action, so it reads as one; the fill stays the
    // design's sage, which is what makes it the recorder rather than another button.
    borderWidth: 2,
    borderColor: tokens.color.accent,
  },
  // FE-D7 2. Phase 3 D7: sage #B8CDB8, pressed #9EB89E. Holding is pressing, so the pressed
  // value holds for the whole recording.
  holding: { backgroundColor: tokens.color.sagePressed },
  // `FE-W190`. The record mark, always drawn: accent while waiting, terracotta while recording —
  // the recording colour every other "on air" mark in the app uses.
  dot: {
    width: 14,
    height: 14,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.accent,
  },
  dotRecording: { backgroundColor: tokens.color.recording },
  // `FE-W190`. The control's own role (17/600), as every button label is. It was body text at
  // regular weight, which is part of why it did not read as something to press.
  holdLabel: {
    fontSize: tokens.typography.control.size,
    lineHeight: tokens.typography.control.lineHeight,
    fontWeight: tokens.typography.control.weight,
    fontFamily: fontFamilyFor(tokens.typography.control.weight),
    color: tokens.color.textPrimary,
    textAlign: 'center',
    flexShrink: 1,
  },
});

/**
 * The hold button's ground. `held` is a finger on it, or a recording still running. Exported so
 * the press can be asserted: a fired press event does not flip React Native's `pressed`.
 */
export const holdStyle = (held: boolean): StyleProp<ViewStyle> => [
  styles.hold,
  held ? styles.holding : null,
];

export const VoiceNoteScreen = ({
  subject,
  prompt,
  hint,
  elapsed,
  recording,
  onHoldStart,
  onHoldEnd,
  onStartAgain,
  onSave,
  busy = false,
  saved = null,
  blocked = null,
  onOpenSettings,
  failure = null,
  actionFailure = null,
  onBack,
}: VoiceNoteScreenProps): ReactNode => {
  const { t } = useT();
  const back = onBack === undefined ? {} : { onBack };
  if (failure !== null) {
    return (
      <Screen scrollable {...back}>
        <Heading>{t('voiceNote.heading')}</Heading>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </Screen>
    );
  }

  const footer =
    blocked !== null ? null : (
      <View style={styles.foot}>
        {onSave === undefined ? null : (
          <Button label={t('voiceNote.save')} loading={busy} onPress={onSave} />
        )}
        {/*
          `FE-W190`. Only once there is something to start again FROM. Offered on an empty
          recorder it was a button that did nothing.
        */}
        {onSave === undefined ? null : (
          <Button label={t('voiceNote.startAgain')} onPress={onStartAgain} variant="secondary" />
        )}
        <Pressable
          accessibilityLabel={t('voiceNote.holdLabel')}
          accessibilityRole="button"
          accessibilityState={{ busy: recording }}
          onPressIn={onHoldStart}
          onPressOut={onHoldEnd}
          style={({ pressed }) => holdStyle(pressed || recording)}
        >
          <View style={[styles.dot, recording ? styles.dotRecording : null]} />
          {/* Ink on the sage, whatever the ground around it: the sage is always light. */}
          <Text style={styles.holdLabel}>
            {recording ? t('voiceNote.holding') : t('voiceNote.hold')}
          </Text>
        </Pressable>
      </View>
    );

  return (
    <Screen scrollable footer={footer} {...back}>
      {/*
        FE-D2 6. Outside the hero surface on purpose: a critical banner is the default surface's
        tone, and inside the dark card it would read as part of the recorder rather than a verdict
        on the last press.
      */}
      {actionFailure === null ? null : (
        <Banner detail={actionFailure.detail} title={actionFailure.title} tone="critical" />
      )}
      <SurfaceContext.Provider value="hero">
        <View style={styles.dark}>
          <Label>{subject}</Label>
          {saved === null ? null : <Statement>{saved}</Statement>}
          <Display>{prompt}</Display>
          <Statement>{hint}</Statement>

          <View style={styles.centre}>
            <Figure>{elapsed}</Figure>
            {/* `FE-W184`. Centred line by line, so a status that wraps stays under the time. */}
            <Label center>
              {blocked !== null
                ? t('voiceNote.statusBlocked')
                : recording
                  ? t('voiceNote.statusRecording')
                  : // FE-D12 V4. A captured, unsaved note is what `onSave` means. "hold the button
                    // to start" under "00:04" told the rep nothing had been recorded.
                    onSave !== undefined
                    ? t('voiceNote.statusRecorded')
                    : t('voiceNote.statusIdle')}
            </Label>
          </View>

          {blocked === null ? null : (
            // Not `critical`: a microphone the MR has not granted is a condition with
            // a remedy, not a failure of theirs. §02. Inside the dark card on purpose: `Banner`
            // takes paper ink on its own fill (`FE-W176`), so it no longer inherits the hero's white.
            <Banner
              detail={blocked}
              title={t('voiceNote.blockedTitle')}
              tone="attention"
              {...(onOpenSettings === undefined
                ? {}
                : { action: { label: t('voiceNote.openSettings'), onPress: onOpenSettings } })}
            />
          )}
        </View>
      </SurfaceContext.Provider>
    </Screen>
  );
};
