import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Heading } from './Text';

/**
 * Phase 1 §05: every option list. A handle, 70pt rows, a sticky footer, and a
 * scrim that dismisses on press.
 *
 * The sheet exists because of §04, not because it is fashionable. A dropdown opens
 * upward from the control, which puts its options above the middle of the screen
 * and out of a one-thumb reach — the other hand is holding a detail bag. A sheet
 * rises from the bottom, so the first row is already inside the reach zone.
 *
 * Height is capped at 70% of the window and the content scrolls inside that; the
 * footer does not scroll, because the confirming action must not be something the
 * MR has to scroll to find.
 */
export interface BottomSheetProps {
  readonly visible: boolean;
  readonly title: string;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
  /** Pinned below the scroll area. A single primary action, per §04. */
  readonly footer?: ReactNode;
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(20,21,15,0.4)',
  },
  sheet: {
    backgroundColor: tokens.color.surface,
    borderTopLeftRadius: tokens.radius.card,
    borderTopRightRadius: tokens.radius.card,
    paddingBottom: tokens.space.lg,
  },
  handleArea: { alignItems: 'center', paddingVertical: tokens.space.sm },
  handle: {
    width: 36,
    height: 4,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.offlineEdge,
  },
  header: { paddingHorizontal: tokens.space.md, paddingBottom: tokens.space.sm },
  content: { paddingHorizontal: tokens.space.md, gap: tokens.space.xs },
  footer: {
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.sm,
    borderTopWidth: 1,
    borderTopColor: tokens.color.hairline,
  },
});

export const BottomSheet = ({
  visible,
  title,
  onDismiss,
  children,
  footer,
}: BottomSheetProps): ReactNode => {
  const { height } = useWindowDimensions();

  return (
    <Modal animationType="slide" onRequestClose={onDismiss} transparent visible={visible}>
      {/*
        The scrim is the dismiss target, so it is a Pressable rather than a View.
        The sheet sits inside it and stops the press going through — without that,
        a tap anywhere on the sheet closes it, including a tap on a row.
      */}
      <Pressable
        accessibilityLabel="Close"
        accessibilityRole="button"
        onPress={onDismiss}
        style={styles.scrim}
      >
        <Pressable
          accessibilityRole="none"
          accessibilityViewIsModal
          onPress={() => {
            // Swallows the press. The scrim above must not see it.
          }}
          style={[styles.sheet, { maxHeight: height * 0.7 }]}
        >
          <View style={styles.handleArea}>
            <View style={styles.handle} />
          </View>
          <View style={styles.header}>
            <Heading>{title}</Heading>
          </View>
          <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
          {footer === undefined ? null : <View style={styles.footer}>{footer}</View>}
        </Pressable>
      </Pressable>
    </Modal>
  );
};
