import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { SwitchRow } from './SwitchRow';
import { BodyText, Label, Secondary, Title } from './Text';
import { t, useT } from './i18n';

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

/** `FE-W155`. Functions, not constants, so each is read in the language in use when shown. */
export const wifiOnlyTitle = (): string => t('settings.wifiOnly');
export const warnOverTitle = (): string => t('settings.warnOver');

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
}: DataSettingsScreenProps): ReactNode => {
  useT();
  return (
    <>
      <Title>{t('dataSettings.title')}</Title>

      {saveFailure === null ? null : (
        <Banner tone="attention" title={t('dataSettings.notSaved')} detail={saveFailure} />
      )}

      {wifiOnlyAudio === null || warnOverMonthly === null ? (
        <Spinner label={t('dataSettings.reading')} />
      ) : (
        <>
          <View style={styles.group}>
            <SwitchRow
              title={wifiOnlyTitle()}
              detail={t('settings.wifiOnlyDetail')}
              value={wifiOnlyAudio}
              disabled={saving}
              onValueChange={(next) => {
                onChange('wifiOnlyAudio', next);
              }}
            />
            <Secondary>{t('dataSettings.wifiOnlyExplain')}</Secondary>
          </View>

          <View style={styles.group}>
            <SwitchRow
              title={warnOverTitle()}
              detail={t('settings.warnOverDetail')}
              value={warnOverMonthly}
              disabled={saving}
              onValueChange={(next) => {
                onChange('warnOverMonthly', next);
              }}
            />
            <Secondary>{t('dataSettings.warnOverExplain')}</Secondary>
          </View>
        </>
      )}

      <Card tone="quiet">
        <Label muted>{t('dataSettings.usedLabel')}</Label>
        <BodyText>{usedThisMonth ?? t('dataSettings.usedUnknown')}</BodyText>
      </Card>
    </>
  );
};
