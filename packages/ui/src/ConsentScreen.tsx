import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Display, Heading, Label, Statement } from './Text';
import { Button } from './Button';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { SurfaceContext } from './surface';

/**
 * Phase 3 — the consent handoff. D1, D2 and D4 in one component.
 *
 * The MR hands their unlocked phone to a doctor mid-consultation. No account, five
 * seconds of attention, and a social cost to saying no. Everything below is either
 * the design's own rule or a consequence of the contract.
 *
 * **The three variants are structurally different arguments, not themes.** They are
 * kept in one component because they share every rule that makes the screen lawful
 * — the equal pair, the third way out, the verbatim notice — and splitting them
 * into three files is how one of them quietly loses one of those rules.
 *
 * **The accent appears nowhere.** Not on a button, not on a rule, not on a chip.
 * The moment one option carries the brand's "go" colour the pair is weighted and a
 * weighted pair voids the consent. This is also why both answers are `secondary`
 * rather than a primary and a secondary: `OverrideControl` already established
 * that a genuine either/or gets two identical `secondary` controls, and §05 allows
 * no fifth button variant to be invented for this screen.
 *
 * **Decline is first in reading order, in all three.** That is the one asymmetry
 * in the design and it tilts against consent, which is the safe direction to tilt.
 *
 * **The attested notice is always on the face of the screen.** `notice` is the
 * server's `ConsentTextVersion.fullText`, rendered verbatim, and the record the
 * device writes carries that version's id. The variants differ in what they put
 * *around* it — an itemised summary, a single sentence, two consequences — and
 * every one of those is app-authored framing. A screen that showed only the
 * framing would make the ledger attest to text the doctor never saw.
 *
 * **What is not built, and why.**
 *
 * - **Landscape.** D1 and D4 are drawn 844 × 390. `app.json` locks the app to
 *   portrait and `expo-screen-orientation` is not a dependency; adding it means a
 *   native module and a new build, which would also take the app out of Expo Go
 *   where it currently runs. The information order of each variant — what is read
 *   first, what is read beside what — survives the rotation, so the variants are
 *   laid out down the screen and the turn is deferred rather than faked.
 * - **`#16180F`.** D2 inverts onto a near-black that is not `#1F211C`. Phase 1
 *   bans a third grey and a second near-black is the same drift, so the inverted
 *   ground is the committed hero ink. White on it is 16.25:1 against the design's
 *   quoted 17.92 — both far past the obligation, and the design's reason for the
 *   inversion ("stop looking like the app the doctor just watched the rep use") is
 *   unaffected by four points of contrast.
 */
export type ConsentVariant =
  /** D1. Four itemised facts. Highest reading load, easiest to defend in writing. */
  | 'itemised'
  /** D2. One sentence on an inverted ground. Fastest to a decision. */
  | 'sentence'
  /** D4. "If you agree" beside "If you'd rather not". Makes declining visible. */
  | 'columns';

/** Only two answers are decisions. Handing the phone back is neither. */
export type ConsentAnswer = 'consented' | 'declined';

export interface ConsentFact {
  /** "What", "Why", "How long", "Changing your mind" — DPDP Rule 3's itemisation. */
  readonly heading: string;
  readonly detail: string;
}

export interface ConsentLanguageOption {
  /** BCP-47, as the record will store it. */
  readonly code: string;
  /** The language's own name, as a doctor would recognise it. */
  readonly label: string;
}

export interface ConsentScreenProps {
  readonly variant: ConsentVariant;
  /** "Rahul More, Elmiron". A doctor asked by a logo is being asked by nobody. */
  readonly askedBy: string;
  /** The question itself. */
  readonly question: string;
  /** D1's four facts. Ignored by the other two variants. */
  readonly facts: readonly ConsentFact[];
  /** D2's single sentence. */
  readonly summary: string;
  /** D4's left panel. */
  readonly ifAgree: string;
  /** D4's right panel. Same width, same treatment, never smaller. */
  readonly ifDecline: string;
  /**
   * The server's `fullText`, verbatim. Required, and required to stay required —
   * see the note at the top of this file.
   */
  readonly notice: string;
  /** "Notice v1.2 · English (India)" — what the record will point at. */
  readonly noticeLabel: string;
  readonly onAnswer: (answer: ConsentAnswer) => void;
  /** The exit that is not a decision. Records nothing. */
  readonly onHandBack: () => void;
  readonly onOpenDetails: () => void;
  /** Languages the server actually has a notice in. Absent when there is one. */
  readonly languages?: readonly ConsentLanguageOption[];
  readonly language?: string;
  readonly onChangeLanguage?: (code: string) => void;
  readonly busy?: boolean;
  /**
   * The notice has been asked for and has not arrived yet.
   *
   * Separate from `blocked` and checked before it, because "we have not looked
   * yet" and "there is no notice" are different sentences and only one of them is
   * true at first paint. Running them together put "There is no consent notice for
   * this language yet" on screen for the second before every fetch resolved — a
   * false statement, on the screen with the least room for one.
   */
  readonly loading?: boolean;
  /**
   * Why the question cannot be put. When this is set the answers are not rendered
   * at all — a consent face with no notice behind it must not be shown to anyone.
   */
  readonly blocked?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  dark: {
    backgroundColor: tokens.color.textPrimary,
    borderRadius: tokens.radius.card,
    padding: tokens.space.md,
    gap: tokens.space.md,
  },
  head: { gap: tokens.space.xs },
  facts: { gap: tokens.space.sm },
  fact: {
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.well,
    padding: tokens.space.md,
    gap: 2,
  },
  panels: { gap: tokens.space.sm },
  panel: {
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.well,
    padding: tokens.space.md,
    gap: tokens.space.sm,
  },
  notice: {
    borderTopWidth: 1,
    borderTopColor: tokens.color.hairline,
    paddingTop: tokens.space.md,
    gap: tokens.space.xs,
  },
  details: {
    minHeight: tokens.target.floor,
    justifyContent: 'center',
  },
  // An underline on the View, not the Text: the affordance has to read as tappable
  // from across a desk, and a bottom rule under the words is what the design draws.
  detailsLabel: {
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.offlineEdge,
    alignSelf: 'flex-start',
  },
  answers: { gap: tokens.space.sm },
  handBack: {
    minHeight: tokens.target.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});

/**
 * The pair, the third way out, and the notice — identical in every variant.
 *
 * Extracted so it cannot drift between the three. Two buttons, same variant, same
 * order, no accent; then an exit that is not an answer, in the muted tone rather
 * than `quiet`, because `quiet` renders its label in the accent green this screen
 * is not allowed to contain.
 */
const Answers = ({
  onAnswer,
  onHandBack,
  busy,
}: Pick<ConsentScreenProps, 'onAnswer' | 'onHandBack'> & { readonly busy: boolean }): ReactNode => (
  <View style={styles.answers}>
    <Button
      label="No, don't record"
      loading={busy}
      onPress={() => {
        onAnswer('declined');
      }}
      variant="secondary"
    />
    <Button
      label="Yes, that's fine"
      loading={busy}
      onPress={() => {
        onAnswer('consented');
      }}
      variant="secondary"
    />
    <Pressable
      accessibilityRole="button"
      onPress={onHandBack}
      style={({ pressed }) => [styles.handBack, pressed ? styles.pressed : null]}
    >
      <Label muted>Give the phone back</Label>
    </Pressable>
  </View>
);

/** The notice itself, plus the way into the legal layer. Present in all variants. */
const Notice = ({
  notice,
  noticeLabel,
  onOpenDetails,
}: Pick<ConsentScreenProps, 'notice' | 'noticeLabel' | 'onOpenDetails'>): ReactNode => (
  <View style={styles.notice}>
    <Statement>{notice}</Statement>
    <Label muted>{noticeLabel}</Label>
    <Pressable
      accessibilityRole="button"
      onPress={onOpenDetails}
      style={({ pressed }) => [styles.details, pressed ? styles.pressed : null]}
    >
      <View style={styles.detailsLabel}>
        <BodyText muted>Exactly what is collected, in full</BodyText>
      </View>
    </Pressable>
  </View>
);

export const ConsentScreen = ({
  variant,
  askedBy,
  question,
  facts,
  summary,
  ifAgree,
  ifDecline,
  notice,
  noticeLabel,
  onAnswer,
  onHandBack,
  onOpenDetails,
  languages,
  language,
  onChangeLanguage,
  busy = false,
  loading = false,
  blocked = null,
}: ConsentScreenProps): ReactNode => {
  if (loading) {
    // Nothing a doctor could answer, and no claim about whether a notice exists.
    return (
      <>
        <Heading>{question}</Heading>
        <Spinner label="Getting the notice" />
      </>
    );
  }

  if (blocked !== null) {
    // No notice, no question. The MR is told why and the doctor is shown nothing.
    return (
      <>
        <Heading>The recording question cannot be asked</Heading>
        <Banner detail={blocked.detail} title={blocked.title} tone="critical" />
      </>
    );
  }

  const picker =
    languages === undefined || languages.length < 2 || onChangeLanguage === undefined ? null : (
      // Offered from what the server actually has. A hard-coded list would offer a
      // doctor a language the server cannot produce a notice in, and the handoff
      // then dead-ends in front of them.
      <Select
        label="Language"
        onChange={onChangeLanguage}
        options={languages.map((option) => ({ value: option.code, label: option.label }))}
        {...(language === undefined ? {} : { value: language })}
      />
    );

  if (variant === 'sentence') {
    return (
      <SurfaceContext.Provider value="hero">
        <View style={styles.dark}>
          <Label>{askedBy}</Label>
          <Display>{summary}</Display>
          <Notice notice={notice} noticeLabel={noticeLabel} onOpenDetails={onOpenDetails} />
          {picker}
          <Answers busy={busy} onAnswer={onAnswer} onHandBack={onHandBack} />
        </View>
      </SurfaceContext.Provider>
    );
  }

  return (
    <>
      <View style={styles.head}>
        <Label muted>{askedBy}</Label>
        <Display>{question}</Display>
      </View>

      {variant === 'itemised' ? (
        <View style={styles.facts}>
          {facts.map((fact) => (
            <View key={fact.heading} style={styles.fact}>
              <Label muted>{fact.heading}</Label>
              <Statement>{fact.detail}</Statement>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.panels}>
          {/*
            Decline is not the second panel by accident. D4's argument is that the
            other two variants make declining *possible* while this one makes it
            *visible* — so both panels are the same component, the same padding and
            the same type, and neither is styled as the lesser outcome.
          */}
          <View style={styles.panel}>
            <Label muted>If you agree</Label>
            <Statement>{ifAgree}</Statement>
          </View>
          <View style={styles.panel}>
            <Label muted>If you'd rather not</Label>
            <Statement>{ifDecline}</Statement>
          </View>
        </View>
      )}

      <Notice notice={notice} noticeLabel={noticeLabel} onOpenDetails={onOpenDetails} />
      {picker}
      <Answers busy={busy} onAnswer={onAnswer} onHandBack={onHandBack} />
    </>
  );
};
