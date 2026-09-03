import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Heading, Label } from './Text';
import { Card } from './Card';
import { StatusGlyph } from './StatusGlyph';

/**
 * C4 — settings.
 *
 * **A control that appears to work and changes nothing is worse than an absent
 * one.** C4's "Send audio on WiFi only" is the clearest case: an MR who flips it
 * believes their recordings will wait for WiFi, and acts on that belief with their
 * own data plan. Shipping the switch before the upload path exists would make the
 * app lie about something the MR pays for.
 *
 * So every entry declares whether it governs anything yet. `available` rows are
 * pressable and do what they say; `not-yet` rows are inert, say so, and exist
 * because seeing that WiFi-only is *intended* — and intended to default on — is
 * itself worth something to whoever is reviewing this app.
 */
export type SettingState = 'available' | 'not-yet';

export interface SettingRow {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly state: SettingState;
  /** Present only on `available` rows. */
  readonly onPress?: () => void;
}

export interface SettingsScreenProps {
  readonly groups: readonly { readonly heading: string; readonly rows: readonly SettingRow[] }[];
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.sm },
  row: { flexDirection: 'row', gap: tokens.space.sm, alignItems: 'flex-start' },
  rowText: { flex: 1, gap: 2 },
});

const NOT_YET = 'Not yet — this setting does not control anything in this build.';

export const SettingsScreen = ({ groups }: SettingsScreenProps): ReactNode => (
  <>
    <Heading>Settings</Heading>

    {groups.map((group) => (
      <View key={group.heading} style={styles.group}>
        <Label muted>{group.heading}</Label>
        {group.rows.map((row) => {
          const body = (
            <View style={styles.row}>
              <StatusGlyph kind={row.state === 'available' ? 'success' : 'offline'} large />
              <View style={styles.rowText}>
                <BodyText>{row.title}</BodyText>
                <Label muted>{row.detail}</Label>
                {row.state === 'not-yet' ? <Label muted>{NOT_YET}</Label> : null}
              </View>
            </View>
          );

          return row.state === 'available' && row.onPress !== undefined ? (
            <Card key={row.id} onPress={row.onPress}>
              {body}
            </Card>
          ) : (
            <Card key={row.id}>{body}</Card>
          );
        })}
      </View>
    ))}
  </>
);
