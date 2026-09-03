import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Heading, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';

/**
 * Phase 4 D3 — the MR's reply, as its own screen.
 *
 * **The reply is a first-class object and the screen size says so.** The design's
 * note is the specification: "anything less signals that contesting is tolerated
 * rather than expected." So it is a full screen with the finding quoted at the top,
 * a real field, a draft state, and a primary action — not a modal, not a row in a
 * menu, not an afterthought under the finding it argues with.
 *
 * **The finding being replied to is shown, and cannot be edited.** `mrResponse` is
 * attached beside the findings in the contract rather than inside them: a reply
 * that changed the finding would destroy the thing being contested, and the
 * manager would review something the machine never said.
 *
 * **Voice input is drawn in the design and is not built.** D3 shows "Or hold to say
 * it instead", which needs the microphone and the audio pipeline that land in
 * FE-W4. `voiceNote` states that plainly rather than rendering a hold-to-talk
 * control that captures nothing — the same rule that keeps the citation's play
 * button off `AnalysisScreen`.
 */
export interface AnalysisReplyScreenProps {
  /** The finding this argues with, in its own words. Not editable. */
  readonly finding: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly onSend: () => void;
  /** Keeps the text without sending it. The MR may want to sleep on it. */
  readonly onSaveDraft: () => void;
  /** Where the reply goes and why it exists. */
  readonly replyNote: string;
  /** Why there is no hold-to-talk control. */
  readonly voiceNote: string;
  readonly busy?: boolean;
  /** "Saved as a draft on this phone." — a completion, not a warning. */
  readonly saved?: string | null;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  spacer: { flex: 1, minHeight: tokens.space.md },
  foot: { gap: tokens.space.sm },
});

export const AnalysisReplyScreen = ({
  finding,
  value,
  onChangeText,
  onSend,
  onSaveDraft,
  replyNote,
  voiceNote,
  busy = false,
  saved = null,
  failure = null,
}: AnalysisReplyScreenProps): ReactNode => {
  if (failure !== null) {
    return (
      <>
        <Heading>Your reply</Heading>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </>
    );
  }

  const empty = value.trim() === '';

  return (
    <>
      <View style={styles.head}>
        <Heading>Your reply</Heading>
        <Label muted>Goes with the finding, wherever it appears</Label>
      </View>

      {saved === null ? null : <Banner detail={saved} title="Saved" tone="info" />}

      <Card>
        <Label muted>Replying to</Label>
        <BodyText>{finding}</BodyText>
      </Card>

      <TextField
        help={voiceNote}
        label="What you want to say"
        onChangeText={onChangeText}
        value={value}
      />

      {/*
        Not a warning tone. Disagreeing is the ordinary use of this screen, and a
        cautionary colour here would be the app hinting that arguing is a risk.
      */}
      <Card tone="offline">
        <BodyText>{replyNote}</BodyText>
      </Card>

      <View style={styles.spacer} />

      {/*
        Branched rather than spread: `ButtonProps` makes `disabled` and `note` a
        union so a disabled button cannot exist without a reason line, and that
        guarantee is exactly what a spread of `{...(empty ? {disabled: true} : {})}`
        would erase.
      */}
      <View style={styles.foot}>
        {empty ? (
          <Button
            disabled
            label="Save as a draft"
            note="Write something first — a draft needs words to keep."
            onPress={onSaveDraft}
            variant="secondary"
          />
        ) : (
          <Button label="Save as a draft" onPress={onSaveDraft} variant="secondary" />
        )}
        {empty ? (
          <Button disabled label="Send reply" note="Write something first." onPress={onSend} />
        ) : (
          <Button
            label="Send reply"
            loading={busy}
            loadingLabel="Sending…"
            note="Your manager sees this next to the finding."
            onPress={onSend}
          />
        )}
      </View>
    </>
  );
};
