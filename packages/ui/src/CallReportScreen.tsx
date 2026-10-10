import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Label, Title } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';

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
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  fields: { gap: tokens.space.md },
  foot: { gap: tokens.space.sm, paddingTop: tokens.space.sm },
  products: { gap: tokens.space.xs },
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    minHeight: 48,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.control,
    borderWidth: 1,
    borderColor: tokens.color.hairline,
  },
  productChosen: { borderColor: tokens.color.textPrimary, borderWidth: 2 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: tokens.color.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
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
}: CallReportScreenProps): ReactNode => (
  <>
    <View style={styles.head}>
      <Title>Your report</Title>
      {/* W2-C A3 / `BE-W156`: no dangling "·" when there is no date to put after it. */}
      <Label muted>{dateLabel === '' ? doctorName : `${doctorName} · ${dateLabel}`}</Label>
    </View>

    {failure === null ? null : (
      <Banner detail={failure.detail} title={failure.title} tone="critical" />
    )}

    <Card>
      <BodyText>Every word here is yours.</BodyText>
      <Label muted>
        Nothing is written for you and nothing is filed until you press Send. Your manager sees what
        you wrote.
      </Label>
    </Card>

    <View style={styles.fields}>
      <TextField
        help="What happened, in your words."
        label="What happened"
        onChangeText={onSummaryChange}
        value={summary}
      />
      <TextField
        help="Anything they pushed back on. Leave it empty if there was nothing."
        label="What they raised"
        onChangeText={onObjectionsChange}
        value={objections}
      />
      <TextField
        help="What you promised, and when."
        label="Next step"
        onChangeText={onNextStepChange}
        value={nextStep}
      />
    </View>

    {products === undefined ? null : (
      <View style={styles.products}>
        <Label>Products discussed</Label>
        <Label muted>Mark each one you talked about. None is fine if none came up.</Label>
        {productsNote === null ? null : <Label muted>{productsNote}</Label>}
        {products.map((product) => {
          const chosen = chosenProductIds.includes(product.id);
          return (
            <Pressable
              accessibilityLabel={product.label}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: chosen }}
              key={product.id}
              onPress={() => {
                onToggleProduct?.(product.id);
              }}
              style={[styles.product, chosen ? styles.productChosen : null]}
            >
              <View style={styles.box}>{chosen ? <BodyText>✓</BodyText> : null}</View>
              <BodyText>{product.label}</BodyText>
            </Pressable>
          );
        })}
      </View>
    )}

    <View style={styles.foot}>
      {/*
        One button, in one of two states. `Button`'s disabled variant requires a
        reason line — §05 — so the branch exists to supply it; rendering both would
        put two Send buttons on the screen.

        FE-D12 item 3. A third state: once the report is sent (or saved to send by itself), the
        button gives way to that outcome, where the rep's thumb is. It stayed enabled before, and a
        second press made a second report of the same visit.
      */}
      {sentNote !== null ? (
        <Banner detail={sentNote.detail} title={sentNote.title} tone="info" />
      ) : summary.trim() === '' ? (
        <Button
          disabled
          label="Send the report"
          note="Write what happened first. The other two are optional."
          onPress={onSend}
        />
      ) : (
        <Button
          label={sending ? 'Sending…' : 'Send the report'}
          loading={sending}
          onPress={onSend}
        />
      )}
    </View>
  </>
);
