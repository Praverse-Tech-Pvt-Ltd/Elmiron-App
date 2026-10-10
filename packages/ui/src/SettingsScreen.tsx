import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Badge } from './Badge';
import { BodyText, Label, Secondary, Title } from './Text';
import { Card } from './Card';

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
  row: { flexDirection: 'row', gap: tokens.space.sm, alignItems: 'center' },
  rowText: { flex: 1, gap: tokens.space.xs / 2 },
});

/**
 * UX polish: the same promise, in plain words. It read "Not yet — this setting does not control
 * anything in this build", an engineer's sentence, under a dashed "offline" glyph. The rule it
 * keeps is unchanged: an unbuilt setting says it does nothing, and cannot be pressed.
 */
const NOT_YET = 'This setting does nothing yet.';

export const SettingsScreen = ({ groups }: SettingsScreenProps): ReactNode => (
  <>
    {/* FE-D12 V5. A screen title, like Today's; FE-D7 4 moved the others and missed this one. */}
    <Title>Settings</Title>

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
                <Secondary>{row.detail}</Secondary>
                {row.state === 'not-yet' ? (
                  <>
                    <Badge label="Coming later" tone="neutral" />
                    <Label muted>{NOT_YET}</Label>
                  </>
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
