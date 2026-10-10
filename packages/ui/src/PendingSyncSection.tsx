import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Heading, Label } from './Text';
import { ListRow } from './ListRow';

/**
 * `BE-W176` — "Pending sync": unplanned visits this phone made that the server has not yet put on a
 * day. **Not part of Today.** MR-47: only the server assigns a visit's day, so these are listed with
 * no day at all, and each leaves this list when the server's copy arrives and shows under its day.
 */
export interface PendingSyncItem {
  readonly id: string;
  readonly doctorName: string;
  readonly clinic: string | null;
  readonly reason: string;
  readonly state: 'waiting' | 'sent' | 'refused';
  /** For a refused visit: what the server said, or where to see it. */
  readonly problem: string | null;
}

export interface PendingSyncSectionProps {
  readonly items: readonly PendingSyncItem[];
  readonly onOpen: (item: PendingSyncItem) => void;
}

const STATE_WORDS: Readonly<Record<PendingSyncItem['state'], string>> = {
  waiting: 'Waiting to send',
  sent: 'Sent — waiting for the server to confirm the day',
  refused: 'Refused by the server',
};

const styles = StyleSheet.create({
  section: { gap: tokens.space.xs, paddingTop: tokens.space.md },
});

export const PendingSyncSection = ({ items, onOpen }: PendingSyncSectionProps): ReactNode =>
  items.length === 0 ? null : (
    <View style={styles.section}>
      <Heading>Pending sync</Heading>
      <Label muted>Day will be confirmed after sync.</Label>
      {items.map((item) => (
        <ListRow
          detail={[item.clinic, `Unplanned · ${item.reason}`, STATE_WORDS[item.state], item.problem]
            .filter((line): line is string => line !== null && line !== '')
            .join('\n')}
          key={item.id}
          onPress={() => {
            onOpen(item);
          }}
          title={item.doctorName}
        />
      ))}
    </View>
  );
