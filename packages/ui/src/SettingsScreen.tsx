import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Badge } from './Badge';
import { BodyText, Label, Secondary, Title } from './Text';
import { Card } from './Card';
import { useT } from './i18n';

/**
 * C4 — settings.
 *
 * **A control that appears to work and changes nothing is worse than an absent
 * one.** C4's "Send audio on WiFi only" is the clearest case: an MR who flips it
 * believes their recordings will wait for WiFi, and acts on that belief with their
 * own data plan. Shipping the switch before the upload path exists would make the
 * app lie about something the MR pays for. (`FE-W135`–`FE-W139` built that path, so
 * WiFi-only and the 100 MB note are `available` now; the language rows are not.)
 *
 * So every entry declares whether it governs anything yet. `available` rows are
 * pressable and do what they say; `not-yet` rows are inert, say so, and exist
 * because seeing that WiFi-only is *intended* — and intended to default on — is
 * itself worth something to whoever is reviewing this app.
 *
 * `FE-W142` adds two states for the language rows. `chosen` is the option in use: drawn as one,
 * and not pressable, because pressing it would change nothing. `info` states a fact the rep
 * cannot change here (which languages the consent notice exists in) without pretending it is a
 * setting that is coming later.
 */
export type SettingState = 'available' | 'not-yet' | 'chosen' | 'info';

export interface SettingRow {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly state: SettingState;
  /** Present only on `available` rows. */
  readonly onPress?: () => void;
  /**
   * `FE-W142`. On a `not-yet` row, what it is waiting for, in place of the generic line — e.g.
   * "Hindi: waiting for translation (0 of 312 done)". Ignored on every other state.
   */
  readonly note?: string;
}

export interface SettingsScreenProps {
  readonly groups: readonly { readonly heading: string; readonly rows: readonly SettingRow[] }[];
  /**
   * `FE-W126`. Shown directly under the title, before every group — the place for a status that must
   * never be silent (live location, `FE-W71`). Above the title, it opened the screen on a banner.
   */
  readonly lead?: ReactNode;
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.sm },
  row: { flexDirection: 'row', gap: tokens.space.sm, alignItems: 'center' },
  rowText: { flex: 1, gap: tokens.space.xs / 2 },
});

/**
 * UX polish: the same promise, in plain words. It read "Not yet — this setting does not control
 * anything in this build", an engineer's sentence, under a dashed "offline" glyph. The rule it
 * keeps is unchanged: an unbuilt setting says it does nothing, and cannot be pressed.
 */
export const SettingsScreen = ({ groups, lead }: SettingsScreenProps): ReactNode => {
  const { t } = useT();
  return (
    <>
      {/* FE-D12 V5. A screen title, like Today's; FE-D7 4 moved the others and missed this one. */}
      <Title>{t('settings.title')}</Title>
      {lead}

      {groups.map((group) => (
        <View key={group.heading} style={styles.group}>
          <Label muted>{group.heading}</Label>
          {group.rows.map((row) => {
            const press = row.state === 'available' ? row.onPress : undefined;
            // A destination is a row with a way in (›), not a green tick: a tick read as "done".
            const body = (
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <BodyText>{row.title}</BodyText>
                  {row.detail === '' ? null : <Secondary>{row.detail}</Secondary>}
                  {row.state === 'not-yet' ? (
                    <>
                      <Badge label={t('settings.comingLater')} tone="neutral" />
                      <Label muted>{row.note ?? t('settings.notYet')}</Label>
                    </>
                  ) : null}
                  {row.state === 'chosen' ? (
                    <Badge label={t('settings.inUse')} tone="success" />
                  ) : null}
                </View>
                {press === undefined ? null : <BodyText muted>›</BodyText>}
              </View>
            );

            return press !== undefined ? (
              <Card key={row.id} onPress={press}>
                {body}
              </Card>
            ) : (
              <Card key={row.id} tone="quiet">
                {body}
              </Card>
            );
          })}
        </View>
      ))}
    </>
  );
};
