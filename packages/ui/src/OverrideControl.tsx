import { useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';

/**
 * Phase 1 §05, the manager's half: "AI finding · advisory · you decide."
 *
 * The design is explicit about the shape and the reason. **Agree and Disagree are
 * identical controls in one row, one tap each, and neither confirms.** Disagreeing
 * is not an error state and carries no warning colour — it is the evidence that a
 * human looked, so the UI treats it as the ordinary half of an ordinary decision.
 * Making disagreement the harder path would quietly turn an advisory system into
 * an authority, which is the failure this component exists to prevent.
 *
 * Hence: both buttons are `secondary`, the same size, in the same row, in that
 * order, and there is no destructive styling anywhere in this file.
 *
 * The reason line is one line and it is logged. `outcomeNote` is what the caller
 * shows afterwards — who was told, and who reviews it — because an override that
 * disappears into a database is not oversight either.
 */
export type OverrideDecision = 'agree' | 'disagree';

export interface OverrideControlProps {
  /** The finding being judged, in the AI's words. */
  readonly finding: string;
  /** Called once, with the decision and the one-line reason. */
  readonly onLog: (decision: OverrideDecision, reason: string) => void;
  /** Shown after logging — "Logged at 14:02. …". Undefined until then. */
  readonly outcomeNote?: string;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: tokens.space.sm },
  half: { flex: 1 },
  advisory: {
    alignSelf: 'flex-start',
    backgroundColor: tokens.color.infoFill,
    borderRadius: tokens.radius.well,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 2,
  },
  logged: {
    backgroundColor: tokens.color.successFill,
    borderRadius: tokens.radius.well,
    padding: tokens.space.sm,
  },
});

export const OverrideControl = ({
  finding,
  onLog,
  outcomeNote,
}: OverrideControlProps): ReactNode => {
  const [decision, setDecision] = useState<OverrideDecision | undefined>(undefined);
  const [reason, setReason] = useState('');

  return (
    <Card>
      <View style={styles.advisory}>
        <Label muted>AI finding · advisory · you decide</Label>
      </View>

      <BodyText>{finding}</BodyText>

      {outcomeNote === undefined ? (
        <>
          <View style={styles.row}>
            <View style={styles.half}>
              <Button
                label="Agree"
                onPress={() => {
                  setDecision('agree');
                }}
                variant="secondary"
              />
            </View>
            <View style={styles.half}>
              <Button
                label="Disagree"
                onPress={() => {
                  setDecision('disagree');
                }}
                variant="secondary"
              />
            </View>
          </View>

          {decision === undefined ? null : (
            <>
              <TextField label="Why — one line, logged" onChangeText={setReason} value={reason} />
              <Button
                label="Log the override"
                onPress={() => {
                  onLog(decision, reason);
                }}
              />
            </>
          )}
        </>
      ) : (
        <View style={styles.logged}>
          <Label>{outcomeNote}</Label>
        </View>
      )}
    </Card>
  );
};
