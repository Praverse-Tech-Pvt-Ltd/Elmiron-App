import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Figure, Heading, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { Stepper } from './Stepper';
import { TextField } from './TextField';

/**
 * Phase 2 C5 — what the MR left behind.
 *
 * **The cap is drawn as a meter and is not one here, and that is the whole
 * argument of this file.** C5 shows "6 of 12 packs" against the UCPMP monthly cap
 * and says the cap "is a hard stop — the app won't let you go past it". No cap
 * exists to enforce: `samples_and_inputs` has no limit column, no check
 * constraint and no function that computes one, and the RLS policy grants a plain
 * insert. `SampleAndInputSchema` calls the caps "enforced server-side", which is
 * an intention rather than a description of the schema in the repo today.
 *
 * A meter drawn from a number this app invented would be the most dangerous
 * possible thing on this screen: an MR who believes the app is holding a
 * compliance line stops holding it themselves, and the first they hear otherwise
 * is a UCPMP finding with their name on it. So `cap` is optional, `capNote` is
 * required, and when nothing authoritative supplies the ceiling the screen says
 * plainly that it is not counting. The meter is built and ready for the day an
 * endpoint answers — see `Stepper`'s `max`, which is wired the same way.
 *
 * **The declared value is asked for rather than assumed.** C5 draws no money
 * field, but `CreateSampleAndInputRequest.declaredValueInr` is required and there
 * is no product catalogue anywhere in the contract to resolve it from. The two
 * options were to ask the MR or to post a zero. A zero is a false declaration in
 * a table that is audit-logged by trigger and append-only by grant, and the MR is
 * the one person who actually knows what they handed over — this is their
 * declaration to make, so the field exists and says so. `MileageScreen` names its
 * missing rupee figure for the same reason; the difference is that this one is a
 * write, which is why it is asked for instead of merely explained.
 *
 * **Nothing here is editable after it is sent.** The grant is `select, insert` and
 * the audit trigger fires on all three verbs; a correction is a new row. The
 * screen therefore has no edit affordance for anything already recorded, because
 * offering one would promise something the database refuses.
 */
export type SampleLineKind = 'sample' | 'input';

export interface SampleLine {
  readonly id: string;
  readonly kind: SampleLineKind;
  readonly itemName: string;
  readonly quantity: number;
  /**
   * As typed, not as a number.
   *
   * A half-entered "12." is a valid thing to be holding mid-keystroke and is not a
   * number; storing it as one would round it away under the MR's thumb. The
   * caller parses it once, on send, where a failure can be shown against the line
   * that caused it.
   */
  readonly declaredValueInr: string;
  /** What is wrong with this line and what right looks like. */
  readonly error?: string;
}

export type SampleLinePatch = Partial<
  Pick<SampleLine, 'kind' | 'itemName' | 'quantity' | 'declaredValueInr'>
>;

/** The monthly ceiling, when something authoritative has supplied one. */
export interface SamplesCap {
  readonly used: number;
  readonly limit: number;
  /** "packs" — the unit the limit counts, in the MR's words. */
  readonly unitLabel: string;
}

export interface SamplesScreenProps {
  readonly doctorName: string;
  /** "14 August" — formatted by the caller. This component does no date work. */
  readonly dateLabel: string;
  readonly lines: readonly SampleLine[];
  readonly onChangeLine: (id: string, patch: SampleLinePatch) => void;
  readonly onAddLine: () => void;
  /** Absent on the only remaining line: a screen with nothing on it has no purpose. */
  readonly onRemoveLine: (id: string) => void;
  readonly onRecord: () => void;
  /**
   * What the app is and is not checking against the UCPMP cap. Required, and
   * required to stay required — see the note at the top of this file.
   */
  readonly capNote: string;
  /** Omit until an endpoint computes it. Never assemble one on the device. */
  readonly cap?: SamplesCap | null;
  readonly busy?: boolean;
  /** "Saved on this phone…" — a completion, not a failure. */
  readonly saved?: string | null;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const KIND_OPTIONS = [
  { value: 'sample', label: 'Sample — product' },
  { value: 'input', label: 'Input — literature or material' },
] as const;

const styles = StyleSheet.create({
  head: { gap: 2 },
  lines: { gap: tokens.space.md },
  meter: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space.sm },
  track: {
    height: tokens.space.sm,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.wash,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: tokens.color.accent },
  spacer: { flex: 1, minHeight: tokens.space.md },
  foot: { gap: tokens.space.sm },
});

/** Clamped, because a server that reports 13 of 12 must not draw past the track. */
const fillWidth = (cap: SamplesCap): `${number}%` => {
  if (cap.limit <= 0) return '0%';
  return `${String(Math.min(100, Math.round((cap.used / cap.limit) * 100)))}%` as `${number}%`;
};

export const SamplesScreen = ({
  doctorName,
  dateLabel,
  lines,
  onChangeLine,
  onAddLine,
  onRemoveLine,
  onRecord,
  capNote,
  cap = null,
  busy = false,
  saved = null,
  loading = false,
  failure = null,
}: SamplesScreenProps): ReactNode => {
  if (failure !== null) {
    return (
      <>
        <Heading>Leave samples</Heading>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </>
    );
  }

  const removable = lines.length > 1;

  return (
    <>
      <View style={styles.head}>
        <Heading>Leave samples</Heading>
        <Label muted>{`${doctorName} · ${dateLabel}`}</Label>
      </View>

      {loading ? <Spinner label="Getting this visit" /> : null}

      {saved === null ? null : (
        // Not a banner with a warning tone: the work landed. §02 keeps the
        // coloured tones for conditions the MR still has to do something about.
        <Banner detail={saved} title="Recorded" tone="info" />
      )}

      <View style={styles.lines}>
        {lines.map((line) => (
          <Card key={line.id}>
            <TextField
              autoCapitalize="sentences"
              help="Exactly as it reads on the pack, so your manager can match it."
              label="What you left"
              onChangeText={(itemName) => {
                onChangeLine(line.id, { itemName });
              }}
              value={line.itemName}
              {...(line.error === undefined ? {} : { error: line.error })}
            />

            <Select
              label="Kind"
              onChange={(kind) => {
                onChangeLine(line.id, { kind: kind === 'input' ? 'input' : 'sample' });
              }}
              options={KIND_OPTIONS}
              value={line.kind}
            />

            <Stepper
              label="Packs"
              onChange={(quantity) => {
                onChangeLine(line.id, { quantity });
              }}
              value={line.quantity}
            />

            <TextField
              help="What your company declares one of these to be worth. Ask your manager if you are not sure — this goes on the record as your declaration."
              keyboardType="number-pad"
              label="Declared value, ₹ each"
              onChangeText={(declaredValueInr) => {
                onChangeLine(line.id, { declaredValueInr });
              }}
              value={line.declaredValueInr}
            />

            {removable ? (
              // `destructive` and placed at the end of the card rather than beside
              // the primary action: §05 keeps a removal out of the reach zone so a
              // resting thumb cannot delete a line the MR just typed.
              <Button
                label="Remove this item"
                onPress={() => {
                  onRemoveLine(line.id);
                }}
                variant="destructive"
              />
            ) : null}
          </Card>
        ))}
      </View>

      <Button label="Add another item" onPress={onAddLine} variant="secondary" />

      <Card>
        <Label muted>Against the UCPMP cap</Label>
        {cap === null ? null : (
          <>
            <View style={styles.meter}>
              <Figure>{String(cap.used)}</Figure>
              <Label muted>{`of ${String(cap.limit)} ${cap.unitLabel}`}</Label>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: fillWidth(cap) }]} />
            </View>
          </>
        )}
        <BodyText>{capNote}</BodyText>
      </Card>

      <View style={styles.spacer} />

      <View style={styles.foot}>
        <Button
          label="Record what I left"
          loading={busy}
          loadingLabel="Recording…"
          note="Signed for on delivery. Saves on this phone if you have no signal."
          onPress={onRecord}
        />
      </View>
    </>
  );
};
