import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Heading, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';

/**
 * C6 — the call report, written by the MR.
 *
 * **The design's version is auto-drafted from a voice note; this one is not, and
 * that is a decision rather than a shortfall.** `frontend-plan-v2.md` §3.6 forbids
 * any screen that displays a transcript, analysis or AI summary, and that line was
 * upheld on 2 September 2026 (`fe-w3-spec.md` §4a). The contract already
 * distinguishes the two — `draftSource` is `'manual' | 'voice_note'` — so this
 * screen produces the manual kind and the other remains unbuilt.
 *
 * **What survives from C6, and is stronger for it.** The design's closing promise
 * is "the version your manager sees is yours, not the machine's". With no machine
 * draft that is unconditionally true: every word here was typed by the MR, and
 * there is no prop on this component through which a generated draft could arrive.
 *
 * **Nothing is filed until Send.** The contract makes an edit a new row rather than
 * a mutation (`version`, `supersedesCallReportId`), so what is sent is a version,
 * not an overwrite — but that only matters if the MR chose to send it at all.
 */
export interface CallReportScreenProps {
  readonly doctorName: string;
  /** "14 August" — formatted by the caller. */
  readonly dateLabel: string;
  readonly summary: string;
  readonly onSummaryChange: (value: string) => void;
  readonly nextStep: string;
  readonly onNextStepChange: (value: string) => void;
  readonly objections: string;
  readonly onObjectionsChange: (value: string) => void;
  readonly onSend: () => void;
  readonly sending?: boolean;
  /** Set once the server has taken it. */
  readonly sentNote?: string | null;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  fields: { gap: tokens.space.md },
  foot: { gap: tokens.space.sm, paddingTop: tokens.space.sm },
});

export const CallReportScreen = ({
  doctorName,
  dateLabel,
  summary,
  onSummaryChange,
  nextStep,
  onNextStepChange,
  objections,
  onObjectionsChange,
  onSend,
  sending = false,
  sentNote = null,
  failure = null,
}: CallReportScreenProps): ReactNode => (
  <>
    <View style={styles.head}>
      <Heading>Your report</Heading>
      <Label muted>{`${doctorName} · ${dateLabel}`}</Label>
    </View>

    {failure === null ? null : (
      <Banner detail={failure.detail} title={failure.title} tone="critical" />
    )}

    {sentNote === null ? null : <Banner detail={sentNote} title="Report sent" tone="info" />}

    <Card>
      <BodyText>Every word here is yours.</BodyText>
      <Label muted>
        Nothing is written for you and nothing is filed until you press Send. Your manager sees what
        you wrote.
      </Label>
    </Card>

    <View style={styles.fields}>
      <TextField
        help="What happened, in your words."
        label="What happened"
        onChangeText={onSummaryChange}
        value={summary}
      />
      <TextField
        help="Anything they pushed back on. Leave it empty if there was nothing."
        label="What they raised"
        onChangeText={onObjectionsChange}
        value={objections}
      />
      <TextField
        help="What you promised, and when."
        label="Next step"
        onChangeText={onNextStepChange}
        value={nextStep}
      />
    </View>

    <View style={styles.foot}>
      {/*
        One button, in one of two states. `Button`'s disabled variant requires a
        reason line — §05 — so the branch exists to supply it; rendering both would
        put two Send buttons on the screen.
      */}
      {summary.trim() === '' ? (
        <Button
          disabled
          label="Send the report"
          note="Write what happened first. The other two are optional."
          onPress={onSend}
        />
      ) : (
        <Button
          label={sending ? 'Sending…' : 'Send the report'}
          loading={sending}
          onPress={onSend}
        />
      )}
    </View>
  </>
);
