import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Heading, Label, Statement } from './Text';
import { Button } from './Button';
import { SurfaceContext } from './surface';

/**
 * Phase 3 D3 — "Exactly what is collected", one tap deep from every variant.
 *
 * **The only screen in the product allowed to be dense**, and the design says so.
 * Everywhere else a wall of text is a failure; here it is the point, because this
 * is the layer a regulator reads and the doctor who wants the detail came looking
 * for it.
 *
 * **It leads with what is *not* collected.** That is the design's own ordering and
 * it is the opposite of how a privacy notice is usually written. The unspoken fear
 * in the room is prescriber surveillance, and the fastest way to answer it is to
 * say what the app will never hold before listing what it will.
 *
 * **The attested text is here verbatim, again.** The face of the consent screen
 * shows it and so does this. `notice` is `ConsentTextVersion.fullText` and
 * `versionLabel` plus `hash` are what make the consent record checkable years
 * later — the design's "Consent notice v2.1" line is that pair, not decoration.
 *
 * `collected` and `neverCollected` are app-authored, and that is a coupling with
 * no mechanical guard: if the notice text and these lists ever disagree, this
 * screen is wrong and nothing here will notice. Both are on the screen together so
 * a human can catch it — see `src/consent/content.ts` for the same warning at the
 * other end.
 */
export interface ConsentDetailItem {
  readonly title: string;
  /** Absent when the title says the whole thing — "Date, time and duration". */
  readonly detail?: string;
}

export interface ConsentDetailsScreenProps {
  /** What the app will never hold. First, deliberately. */
  readonly neverCollected: string;
  readonly collected: readonly ConsentDetailItem[];
  /** The server's `fullText`, verbatim. */
  readonly notice: string;
  /** "Notice v1.2 · English (India) · a1b2c3d4" — label, language, hash prefix. */
  readonly noticeLabel: string;
  /** Who the Data Fiduciary is and where a complaint goes. */
  readonly fiduciaryNote: string;
  readonly onBack: () => void;
}

const styles = StyleSheet.create({
  dark: {
    backgroundColor: tokens.color.textPrimary,
    borderRadius: tokens.radius.card,
    padding: tokens.space.md,
    gap: tokens.space.md,
  },
  rows: { gap: 0 },
  row: {
    borderTopWidth: 1,
    borderTopColor: tokens.color.offlineEdge,
    paddingVertical: tokens.space.sm,
    gap: 2,
  },
  last: { borderBottomWidth: 1, borderBottomColor: tokens.color.offlineEdge },
  notice: { gap: tokens.space.xs },
});

export const ConsentDetailsScreen = ({
  neverCollected,
  collected,
  notice,
  noticeLabel,
  fiduciaryNote,
  onBack,
}: ConsentDetailsScreenProps): ReactNode => (
  <SurfaceContext.Provider value="hero">
    <View style={styles.dark}>
      <Heading>Exactly what is collected</Heading>

      {/*
        Never-collected first. On the hero ground there is no second ink tone —
        §01 bans a muted white — so this leads by position and by being the only
        item with no siblings above it, rather than by colour.
      */}
      <View style={[styles.row, styles.last]}>
        <BodyText>Never collected</BodyText>
        <Statement>{neverCollected}</Statement>
      </View>

      <View style={styles.rows}>
        {collected.map((item) => (
          <View key={item.title} style={styles.row}>
            <BodyText>{item.title}</BodyText>
            {item.detail === undefined ? null : <Statement>{item.detail}</Statement>}
          </View>
        ))}
      </View>

      <View style={styles.notice}>
        <Label>The notice you are agreeing to</Label>
        <Statement>{notice}</Statement>
        <Label>{noticeLabel}</Label>
      </View>

      <Label>{fiduciaryNote}</Label>

      <Button label="Back to the question" onPress={onBack} variant="secondary" />
    </View>
  </SurfaceContext.Provider>
);
