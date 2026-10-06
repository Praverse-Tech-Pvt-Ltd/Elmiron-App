import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Label, Title } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';

/**
 * W2-C B / `BE-W159` — the rep FLAGS a possible side effect (`BE-C36`, 1 October).
 *
 * **What this screen is NOT, and the absences are the specification.** The ruling: the rep flags a
 * possible adverse event and performs NO medical assessment; patient-identifiable information stays
 * out. So there is one field, for what the rep heard, in their words. There is no severity, no
 * seriousness, no outcome, no "is it related" — those are the safety team's, and a field here would
 * ask the rep for a judgement the ruling says is not theirs. There is no patient field of any kind,
 * so none can be required.
 *
 * **Making the alternative hard.** `identifierNote` is set by the caller while the text contains
 * something that looks like a phone number, an email address or an ID number, and the Send button
 * is withheld until it is removed. A name cannot be detected reliably and is not attempted; the
 * guidance asks for none, plainly, above the field.
 */
export interface AdverseEventScreenProps {
  readonly doctorName: string;
  readonly text: string;
  readonly onTextChange: (value: string) => void;
  readonly onSend: () => void;
  readonly sending?: boolean;
  /** Why Send is withheld because of what the text contains, or null. */
  readonly identifierNote?: string | null;
  /** What happened to the flag, in its own words — sent, or saved to send by itself. */
  readonly outcome?: { readonly title: string; readonly detail: string } | null;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  foot: { gap: tokens.space.sm, paddingTop: tokens.space.sm },
});

export const AdverseEventScreen = ({
  doctorName,
  text,
  onTextChange,
  onSend,
  sending = false,
  identifierNote = null,
  outcome = null,
  failure = null,
}: AdverseEventScreenProps): ReactNode => (
  <>
    <View style={styles.head}>
      <Title>Flag a possible side effect</Title>
      <Label muted>{doctorName}</Label>
    </View>

    {failure === null ? null : (
      <Banner detail={failure.detail} title={failure.title} tone="critical" />
    )}

    <Card>
      <BodyText>You are flagging it, not assessing it.</BodyText>
      <Label muted>
        Write what you were told, in your own words. The safety team decides what it means and will
        contact the doctor if they need more.
      </Label>
      <Label muted>
        Do not write the patient’s name, phone number, address or any ID number. They are not
        needed, and they must not leave the clinic through this app.
      </Label>
    </Card>

    <TextField
      help="What the doctor told you about it."
      label="What happened"
      onChangeText={onTextChange}
      value={text}
    />

    <View style={styles.foot}>
      {outcome !== null ? (
        <Banner detail={outcome.detail} title={outcome.title} tone="info" />
      ) : identifierNote !== null ? (
        <Button disabled label="Send the flag" note={identifierNote} onPress={onSend} />
      ) : text.trim() === '' ? (
        <Button disabled label="Send the flag" note="Write what happened first." onPress={onSend} />
      ) : (
        <Button label={sending ? 'Sending…' : 'Send the flag'} loading={sending} onPress={onSend} />
      )}
    </View>
  </>
);
