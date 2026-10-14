import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Label, MAX_FONT_SCALE, Secondary, Title } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { Screen } from './Screen';
import { TextField } from './TextField';
import { useT } from './i18n';

/**
 * C6 — the call report, written by the MR.
 *
 * **The design's version is auto-drafted from a voice note; this one is not, and
 * that is a decision rather than a shortfall.** `frontend-plan-v2.md` §3.6 forbids
 * any screen that displays a transcript, analysis or AI summary, and that line was
 * upheld on 2 September 2026 (`fe-w3-spec.md` §4a). The contract already
 * distinguishes the two — `draftSource` is `'manual' | 'voice_note'` — so this
 * screen produces the manual kind and the other remains unbuilt.
 *
 * **What survives from C6, and is stronger for it.** The design's closing promise
 * is "the version your manager sees is yours, not the machine's". With no machine
 * draft that is unconditionally true: every word here was typed by the MR, and
 * there is no prop on this component through which a generated draft could arrive.
 *
 * **Nothing is filed until Send.** The contract makes an edit a new row rather than
 * a mutation (`version`, `supersedesCallReportId`), so what is sent is a version,
 * not an overwrite — but that only matters if the MR chose to send it at all.
 */
export interface CallReportScreenProps {
  readonly doctorName: string;
  /** "14 August" — formatted by the caller. */
  readonly dateLabel: string;
  readonly summary: string;
  readonly onSummaryChange: (value: string) => void;
  readonly nextStep: string;
  readonly onNextStepChange: (value: string) => void;
  readonly objections: string;
  readonly onObjectionsChange: (value: string) => void;
  readonly onSend: () => void;
  readonly sending?: boolean;
  /**
   * The outcome banner: what happened to the report, in its own words.
   *
   * **A `{ title, detail }` pair, not a bare string, and MR-25 D1 is why.** This was
   * `sentNote?: string`, rendered under a HARDCODED `title="Report sent"`. The route sets it
   * for the QUEUED outcome as well as the sent one, so a report saved with no signal was
   * headed "Report sent" above a body reading "Saved on this phone. It will send by itself
   * when you have signal" — the two halves of the same banner contradicting each other, with
   * the heading making the claim a reader actually takes away.
   *
   * MR-18 B3 replaced this screen's copy precisely so it would stop claiming the server had
   * work it did not have. The detail was fixed and the title was left behind, which is the
   * same defect in the half nobody re-read. The title now comes from the caller, so the
   * branch that knows the outcome is the branch that names it.
   */
  readonly sentNote?: { readonly title: string; readonly detail: string } | null;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
  /**
   * `BE-W175` — the company's products, to mark which were discussed. Ids only leave the screen;
   * the server checks each one. Absent (`undefined`) on a caller that has no catalogue, which keeps
   * the screen exactly as it was.
   */
  readonly products?: readonly { readonly id: string; readonly label: string }[];
  readonly chosenProductIds?: readonly string[];
  readonly onToggleProduct?: (id: string) => void;
  /** Says where the list came from when it is not fresh -- or that there is none on this phone. */
  readonly productsNote?: string | null;
  /**
   * UX polish. Where the rep goes once the report is sent or saved -- back to the visit. Without it
   * the outcome banner was a dead end at the bottom of the form.
   */
  readonly onDone?: () => void;
  /** `FE-W188`. The screen's Back control (`Screen`'s `onBack`). */
  readonly onBack?: () => void;
}

const styles = StyleSheet.create({
  head: { gap: tokens.space.xxs },
  fields: { gap: tokens.space.md },
  foot: { gap: tokens.space.sm },
  products: { gap: tokens.space.xs },
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    // The secondary touch target (52), not a 48 literal below it.
    minHeight: tokens.target.secondary,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.control,
    borderWidth: 1,
    borderColor: tokens.color.hairline,
  },
  productChosen: { borderColor: tokens.color.textPrimary, borderWidth: 2 },
  box: {
    width: tokens.space.lg,
    height: tokens.space.lg,
    borderRadius: tokens.radius.sm,
    borderWidth: 2,
    borderColor: tokens.color.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * `FE-W179`. The tick inside the drawn box. The system face, as `StatusGlyph`'s marks are (U+2713
   * is not a letter DM Sans promises), and capped in how far it grows with the font size: the box
   * is a fixed 24pt, and an uncapped tick at the largest font sizes stands out of it.
   */
  tick: {
    color: tokens.color.textPrimary,
    fontSize: tokens.typography.body.size,
    lineHeight: tokens.typography.label.lineHeight,
    textAlign: 'center',
  },
});

export const CallReportScreen = ({
  doctorName,
  dateLabel,
  summary,
  onSummaryChange,
  nextStep,
  onNextStepChange,
  objections,
  onObjectionsChange,
  onSend,
  sending = false,
  sentNote = null,
  failure = null,
  products,
  chosenProductIds = [],
  onToggleProduct,
  productsNote = null,
  onDone,
  onBack,
}: CallReportScreenProps): ReactNode => {
  const { t } = useT();
  return (
    <Screen
      scrollable
      {...(onBack === undefined ? {} : { onBack })}
      footer={
        <View style={styles.foot}>
          {/*
            One button, in one of two states. `Button`'s disabled variant requires a
            reason line — §05 — so the branch exists to supply it; rendering both would
            put two Send buttons on the screen.

            FE-D12 item 3. A third state: once the report is sent (or saved to send by itself), the
            button gives way to that outcome, where the rep's thumb is. It stayed enabled before, and a
            second press made a second report of the same visit. UX polish: with a way back to the visit.
          */}
          {sentNote !== null ? (
            <>
              <Banner detail={sentNote.detail} title={sentNote.title} tone="info" />
              {onDone === undefined ? null : (
                <Button label={t('common.backToVisit')} onPress={onDone} variant="secondary" />
              )}
            </>
          ) : summary.trim() === '' ? (
            <Button
              disabled
              label={t('report.send')}
              note={t('report.sendNote')}
              onPress={onSend}
            />
          ) : (
            <Button
              label={sending ? t('report.sending') : t('report.send')}
              loading={sending}
              onPress={onSend}
            />
          )}
        </View>
      }
    >
      <View style={styles.head}>
        <Title>{t('report.title')}</Title>
        {/* W2-C A3 / `BE-W156`: no dangling "·" when there is no date to put after it. */}
        <Secondary>{dateLabel === '' ? doctorName : `${doctorName} · ${dateLabel}`}</Secondary>
      </View>

      {failure === null ? null : (
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      )}

      <Card>
        <BodyText>{t('report.yours')}</BodyText>
        <Secondary>{t('report.yoursDetail')}</Secondary>
      </Card>

      <View style={styles.fields}>
        <TextField
          help={t('report.summaryHelp')}
          label={t('report.summaryLabel')}
          multiline
          onChangeText={onSummaryChange}
          value={summary}
        />
        <TextField
          help={t('report.objectionsHelp')}
          label={t('report.objectionsLabel')}
          multiline
          onChangeText={onObjectionsChange}
          value={objections}
        />
        <TextField
          help={t('report.nextStepHelp')}
          label={t('report.nextStepLabel')}
          onChangeText={onNextStepChange}
          value={nextStep}
        />
      </View>

      {products === undefined ? null : (
        <View style={styles.products}>
          {/* `FE-W178`. A section header, drawn as C6 draws "Products discussed": muted 13.5. */}
          <Label muted>{t('report.products')}</Label>
          <Secondary>{t('report.productsHelp')}</Secondary>
          {productsNote === null ? null : <Secondary>{productsNote}</Secondary>}
          {products.map((product) => {
            const chosen = chosenProductIds.includes(product.id);
            return (
              <Pressable
                // The product's own name: data, not catalogue text.
                accessibilityLabel={product.label}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: chosen }}
                key={product.id}
                onPress={() => {
                  onToggleProduct?.(product.id);
                }}
                style={[styles.product, chosen ? styles.productChosen : null]}
              >
                <View style={styles.box}>
                  {chosen ? (
                    <Text
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                      style={styles.tick}
                    >
                      ✓
                    </Text>
                  ) : null}
                </View>
                <BodyText>{product.label}</BodyText>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
};
