import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Display, Figure, Heading, Label, Statement } from './Text';
import { Button } from './Button';
import { SurfaceContext } from './surface';

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
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  dark: {
    backgroundColor: tokens.color.textPrimary,
    borderRadius: tokens.radius.card,
    padding: tokens.space.md,
    gap: tokens.space.md,
  },
  centre: { alignItems: 'center', gap: tokens.space.xs },
  hold: {
    minHeight: tokens.target.inVisit,
    borderRadius: tokens.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: tokens.space.sm,
    backgroundColor: tokens.color.successFill,
  },
  holding: { backgroundColor: tokens.color.success },
  dot: {
    width: 14,
    height: 14,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.textPrimary,
  },
});

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
  failure = null,
}: VoiceNoteScreenProps): ReactNode => {
  if (failure !== null) {
    return (
      <>
        <Heading>Your note</Heading>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </>
    );
  }

  return (
    <SurfaceContext.Provider value="hero">
      <View style={styles.dark}>
        <Label>{subject}</Label>
        {saved === null ? null : <Statement>{saved}</Statement>}
        <Display>{prompt}</Display>
        <Statement>{hint}</Statement>

        <View style={styles.centre}>
          <Figure>{elapsed}</Figure>
          <Label>
            {blocked !== null
              ? 'nothing is being recorded'
              : recording
                ? 'keep holding · release to finish'
                : 'hold the button to start'}
          </Label>
        </View>

        {blocked === null ? (
          <>
            <Pressable
              accessibilityLabel="Hold to record your note"
              accessibilityRole="button"
              accessibilityState={{ busy: recording }}
              onPressIn={onHoldStart}
              onPressOut={onHoldEnd}
              style={[styles.hold, recording ? styles.holding : null]}
            >
              {recording ? <View style={styles.dot} /> : null}
              <BodyText>{recording ? 'Holding — recording' : 'Hold to record'}</BodyText>
            </Pressable>

            {onSave === undefined ? null : (
              <Button label="Save this note" loading={busy} onPress={onSave} />
            )}
            <Button label="Start again" onPress={onStartAgain} variant="secondary" />
          </>
        ) : (
          // Not `critical`: a microphone the MR has not granted is a condition with
          // a remedy, not a failure of theirs. §02.
          <Banner detail={blocked} title="No note can be recorded yet" tone="attention" />
        )}
      </View>
    </SurfaceContext.Provider>
  );
};
