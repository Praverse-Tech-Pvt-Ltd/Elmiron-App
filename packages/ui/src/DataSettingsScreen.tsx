import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { SwitchRow } from './SwitchRow';
import { BodyText, Label, Secondary, Title } from './Text';

/**
 * `FE-W139` — C4's two "Your data" settings, as switches that govern something.
 *
 * `SettingsScreen`'s rule is why this screen waited: a switch that appears to work and changes
 * nothing is worse than none. Both now do what they say, and the sentences under them say exactly
 * what -- including what is NOT counted, because the figure here is the one an MR reads before
 * deciding whether to keep WiFi-only on.
 *
 * **A pure function of its props.** Reading and saving the switches is the route's; this cannot
 * move a switch the phone did not keep.
 */
export type DataSettingKey = 'wifiOnlyAudio' | 'warnOverMonthly';

export interface DataSettingsScreenProps {
  /** `null` until the phone's saved value has been read: no switch is drawn in a guessed position. */
  readonly wifiOnlyAudio: boolean | null;
  readonly warnOverMonthly: boolean | null;
  readonly onChange: (key: DataSettingKey, next: boolean) => void;
  /** True while a change is being written; both switches wait for it. */
  readonly saving?: boolean;
  /** The last change did not save. The switch stays where the phone has it. */
  readonly saveFailure?: string | null;
  /**
   * This app's mobile-data uploads this month, formatted ("12.4 MB"), or `null` when the server has
   * not yet said which month it is.
   */
  readonly usedThisMonth: string | null;
}

export const WIFI_ONLY_TITLE = 'Send audio on WiFi only';
export const WARN_OVER_TITLE = 'Warn me over 100 MB';

const styles = StyleSheet.create({
  group: { gap: tokens.space.sm },
});

export const DataSettingsScreen = ({
  wifiOnlyAudio,
  warnOverMonthly,
  onChange,
  saving = false,
  saveFailure = null,
  usedThisMonth,
}: DataSettingsScreenProps): ReactNode => (
  <>
    <Title>Mobile data</Title>

    {saveFailure === null ? null : (
      <Banner tone="attention" title="That change was not saved" detail={saveFailure} />
    )}

    {wifiOnlyAudio === null || warnOverMonthly === null ? (
      <Spinner label="Reading your settings" />
    ) : (
      <>
        <View style={styles.group}>
          <SwitchRow
            title={WIFI_ONLY_TITLE}
            detail="Recordings wait for WiFi. Everything else still sends."
            value={wifiOnlyAudio}
            disabled={saving}
            onValueChange={(next) => {
              onChange('wifiOnlyAudio', next);
            }}
          />
          <Secondary>
            Voice notes and visit recordings wait while this phone is on mobile data, or cannot tell
            which network it is on. They stay safe on this phone, and you can still send them from
            the list of things waiting to send.
          </Secondary>
        </View>

        <View style={styles.group}>
          <SwitchRow
            title={WARN_OVER_TITLE}
            detail="A note on home, nothing stops working."
            value={warnOverMonthly}
            disabled={saving}
            onValueChange={(next) => {
              onChange('warnOverMonthly', next);
            }}
          />
          <Secondary>
            Counts what this app uploads over mobile data each month, by India’s date: your audio
            and the work you send. Downloads, other apps and the phone’s own use are not counted, so
            your plan’s total will be higher.
          </Secondary>
        </View>
      </>
    )}

    <Card tone="quiet">
      <Label muted>This app’s uploads over mobile data this month</Label>
      <BodyText>{usedThisMonth ?? 'Shown once this phone has synced today.'}</BodyText>
    </Card>
  </>
);
