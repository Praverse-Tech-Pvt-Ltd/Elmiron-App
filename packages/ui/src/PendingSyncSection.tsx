import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Label, Secondary } from './Text';
import { ListItem } from './ListItem';
import type { StatusKind } from './StatusGlyph';
import { useT } from './i18n';
import type { TextKey } from './i18n';

/**
 * `BE-W176` — "Pending sync": unplanned visits this phone made that the server has not yet put on a
 * day. **Not part of Today.** MR-47: only the server assigns a visit's day, so these are listed with
 * no day at all, and each leaves this list when the server's copy arrives and shows under its day.
 *
 * UX polish: each visit is a `ListItem` whose STATE is its own line with its own glyph -- waiting
 * is the offline dashed ring (normal, not a fault), sent is info, refused is critical -- where it
 * used to be the third line of one muted paragraph, unscannable at a glance.
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

const STATE_WORDS: Readonly<Record<PendingSyncItem['state'], TextKey>> = {
  waiting: 'pending.waiting',
  sent: 'pending.sent',
  refused: 'pending.refused',
};

const STATE_GLYPH: Readonly<Record<PendingSyncItem['state'], StatusKind>> = {
  waiting: 'offline',
  sent: 'info',
  refused: 'critical',
};

const styles = StyleSheet.create({
  section: { gap: tokens.space.sm, paddingTop: tokens.space.sm },
  head: { gap: tokens.space.xxs },
});

export const PendingSyncSection = ({ items, onOpen }: PendingSyncSectionProps): ReactNode => {
  const { t } = useT();
  return items.length === 0 ? null : (
    <View style={styles.section}>
      <View style={styles.head}>
        {/* `FE-W178`. A section header, muted 13.5, as B6 draws "Added today". */}
        <Label muted>{t('pending.heading')}</Label>
        <Secondary>{t('pending.lead')}</Secondary>
      </View>
      {items.map((item) => (
        <ListItem
          // The state first, beside its glyph; then where and why.
          detail={[
            t(STATE_WORDS[item.state]),
            item.problem,
            item.clinic,
            t('pending.unplanned', { reason: item.reason }),
          ]
            .filter((line): line is string => line !== null && line !== '')
            .join('\n')}
          key={item.id}
          onPress={() => {
            onOpen(item);
          }}
          status={STATE_GLYPH[item.state]}
          title={item.doctorName}
        />
      ))}
    </View>
  );
};
