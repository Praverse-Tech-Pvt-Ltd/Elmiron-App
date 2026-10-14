import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Heading } from './Text';

/**
 * One piece of a published notice, as `apps/field`'s `noticeBlocks` splits it (`FE-W162`). Declared
 * structurally, as `QueueScreenProps` is: a package does not import from an app.
 */
export type NoticeTextBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'bullets'; readonly items: readonly string[] };

export interface NoticeTextProps {
  readonly blocks: readonly NoticeTextBlock[];
}

const styles = StyleSheet.create({
  body: { gap: tokens.space.sm },
  /**
   * `FE-W191`. A section heading takes a margin above it, so it belongs to the paragraphs BELOW it.
   * In the card's even 8pt gap "When your location is shared" sat as close to the paragraph it ends
   * as to the one it starts (QA screenshot 11), and the notice read as one block.
   */
  sectionHeading: { paddingTop: tokens.space.md },
  bullets: { gap: tokens.space.xs },
  // A bullet hangs: the mark in its own column, a wrapped line under its own first word (`FE-W184`).
  bullet: { flexDirection: 'row', gap: tokens.space.sm },
  bulletText: { flex: 1 },
});

/**
 * A published notice laid out as written — headings, paragraphs, bullets — with every word kept.
 * The words are the publisher's and are shown exactly as given: legal wording that only an approved
 * version may change (`FE-W155`), so nothing here passes them through the catalogue.
 */
export const NoticeText = ({ blocks }: NoticeTextProps): ReactNode => (
  <View style={styles.body}>
    {blocks.map((block, index) => {
      const key = `${String(index)}:${block.kind}`;
      if (block.kind === 'heading') {
        return (
          <View key={key} style={index === 0 ? null : styles.sectionHeading}>
            <Heading>{block.text}</Heading>
          </View>
        );
      }
      if (block.kind === 'paragraph') return <BodyText key={key}>{block.text}</BodyText>;
      return (
        <View key={key} style={styles.bullets}>
          {block.items.map((item, at) => (
            <View key={`${key}:${String(at)}`} style={styles.bullet}>
              <BodyText>•</BodyText>
              <View style={styles.bulletText}>
                <BodyText>{item}</BodyText>
              </View>
            </View>
          ))}
        </View>
      );
    })}
  </View>
);
