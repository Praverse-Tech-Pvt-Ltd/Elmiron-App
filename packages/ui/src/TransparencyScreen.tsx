import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Display, Heading, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { StatusGlyph } from './StatusGlyph';
import { t, useT } from './i18n';
import type { TextKey } from './i18n';

/**
 * Phase 2 A9 / C3 — "Everything, before you ask."
 *
 * **The `state` field is the whole reason this component is not a static block of
 * copy.** A9 lists what the app records. The list is only worth showing if it is
 * true, and today most of it is not: this app takes no position fix, records no
 * audio and stores no voice note, because the policy decision behind location is
 * open (`fe-w3-spec.md` §4) and capture lands in FE-W4. A screen that promised
 * "Where you are, during your shift" today would be describing a capability the
 * app does not have — on the one screen whose entire value is that it does not
 * overstate.
 *
 * So each row says which of three things it is: something happening now, something
 * the app cannot do yet, or something that will never happen. The design's own
 * note is that the **never** block matters more than the list above it — "field-
 * force fear is about the phone in their pocket after 7pm" — so it renders last,
 * whole, and is not a row that can be scrolled past among the others.
 *
 * C3's live counts (148 location points, 9 check-ins) and its "Who has looked"
 * audit trail are not here. Neither has a source in the contract client, and the
 * design marks the audit trail "Not in the brief — it needs your call".
 */
export type TransparencyState =
  /** Happening now, with this build. */
  | 'active'
  /** Designed, not built. Named so the MR is not told it is already running. */
  | 'not-yet'
  /** Never, by design. */
  | 'never';

export interface TransparencyEntry {
  readonly title: string;
  readonly detail: string;
  readonly state: TransparencyState;
}

export interface TransparencyScreenProps {
  /**
   * One sentence stating what is true right now, above the list. Present when the
   * honest answer differs from what the list describes — as it does today, when
   * none of the capture below is built.
   */
  readonly preamble?: string;
  readonly entries: readonly TransparencyEntry[];
  /** The "what we never record" sentence, verbatim. */
  readonly neverRecorded: string;
  readonly onContinue?: () => void;
  readonly continueLabel?: string;
}

const styles = StyleSheet.create({
  intro: { gap: tokens.space.xs },
  row: { flexDirection: 'row', gap: tokens.space.sm, alignItems: 'flex-start' },
  rowText: { flex: 1, gap: tokens.space.xxs },
  // The never block is a card of its own, at the end, in the ink surface — it is
  // the answer to the question the MR actually came with.
  neverHead: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
});

const MARK = { active: 'success', 'not-yet': 'offline', never: 'critical' } as const;

const NOTE: Readonly<Record<TransparencyState, TextKey | null>> = {
  active: null,
  'not-yet': 'transparency.notYet',
  never: null,
};

export const TransparencyScreen = ({
  preamble,
  entries,
  neverRecorded,
  onContinue,
  continueLabel,
}: TransparencyScreenProps): ReactNode => {
  useT();
  return (
    <>
      <View style={styles.intro}>
        <Display>{t('settings.transparencyDetail')}</Display>
        {/* FE-D12 item 1. The promise that followed ("It never changes without telling you") had
          nothing behind it, and this screen had gone stale unannounced. The fact stays. */}
        <Label muted>{t('transparency.openAnyTime')}</Label>
      </View>

      {preamble === undefined ? null : (
        <Card>
          <BodyText>{preamble}</BodyText>
        </Card>
      )}

      {entries.map((entry) => {
        const note = NOTE[entry.state];
        return (
          <Card key={entry.title}>
            <View style={styles.row}>
              <StatusGlyph kind={MARK[entry.state]} large />
              <View style={styles.rowText}>
                <BodyText>{entry.title}</BodyText>
                <Label muted>{entry.detail}</Label>
                {note === null ? null : <Label muted>{t(note)}</Label>}
              </View>
            </View>
          </Card>
        );
      })}

      <Card tone="hero">
        <View style={styles.neverHead}>
          <Heading>{t('transparency.neverHeading')}</Heading>
        </View>
        <BodyText>{neverRecorded}</BodyText>
      </Card>

      {onContinue === undefined ? null : (
        <Button label={continueLabel ?? t('transparency.startFirstDay')} onPress={onContinue} />
      )}
    </>
  );
};
