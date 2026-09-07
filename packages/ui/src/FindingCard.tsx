import { useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Heading, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { CitationSpan } from './CitationSpan';
import type { CitationSpanProps } from './CitationSpan';
import { TextField } from './TextField';

/**
 * Phase 1 §05: "what happened · the evidence · your reply." In that order, and all
 * three every time.
 *
 * `citation` is required, not optional. §05 calls the citation the atom of
 * contestability and says every finding has one; a `FindingCard` that could render
 * without evidence would be a coaching claim the MR cannot check, which is the
 * thing this design is built to prevent.
 *
 * The reply is the MR's, and the footer says plainly who sees it and when. The
 * sequence matters: the MR reads the finding *before* their manager acts on it,
 * and their reply travels with it. That is written on the card rather than in a
 * help page because it is the difference between coaching and surveillance, and it
 * is only true if the MR knows it.
 *
 * Nothing here is a score and nothing is compared to anyone else — so this
 * component has no rating, no numeric field and no place to put one.
 */
export type FindingKind = 'worked-well' | 'try-this';

export interface FindingCardProps {
  readonly kind: FindingKind;
  /** What happened, in one sentence. */
  readonly summary: string;
  readonly citation: CitationSpanProps;
  /** The MR's reply, once written. Undefined means they have not replied yet. */
  readonly reply?: string;
  readonly onReply: (reply: string) => void;
}

const TITLES: Record<FindingKind, string> = {
  'worked-well': 'Worked well',
  'try-this': 'One thing to try',
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  keel: { width: 3, alignSelf: 'stretch', borderRadius: tokens.radius.pill },
  workedWell: { backgroundColor: tokens.color.success },
  tryThis: { backgroundColor: tokens.color.attention },
  footer: {
    borderTopWidth: 1,
    borderTopColor: tokens.color.hairline,
    paddingTop: tokens.space.sm,
    gap: tokens.space.xs,
  },
  composer: { gap: tokens.space.sm },
  row: { flexDirection: 'row', gap: tokens.space.sm },
  grow: { flex: 1 },
});

export const FindingCard = ({
  kind,
  summary,
  citation,
  reply,
  onReply,
}: FindingCardProps): ReactNode => {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(reply ?? '');

  return (
    <Card>
      <View style={styles.head}>
        <View style={[styles.keel, kind === 'worked-well' ? styles.workedWell : styles.tryThis]} />
        <Heading>{TITLES[kind]}</Heading>
      </View>

      <BodyText>{summary}</BodyText>

      <CitationSpan {...citation} />

      {reply === undefined ? null : (
        <View>
          <Label muted>Your reply</Label>
          <BodyText>{reply}</BodyText>
        </View>
      )}

      {composing ? (
        <View style={styles.composer}>
          <TextField
            label="Your reply — your manager sees this next to the finding"
            onChangeText={setDraft}
            value={draft}
          />
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button
                label="Send reply"
                onPress={() => {
                  onReply(draft);
                  setComposing(false);
                }}
              />
            </View>
            <Button
              label="Cancel"
              onPress={() => {
                setDraft(reply ?? '');
                setComposing(false);
              }}
              variant="quiet"
            />
          </View>
        </View>
      ) : (
        <Button
          label={reply === undefined ? 'Add your reply' : 'Edit your reply'}
          onPress={() => {
            setComposing(true);
          }}
          variant="secondary"
        />
      )}

      <View style={styles.footer}>
        <Label muted>
          You are seeing this before your manager acts on it. Your reply goes with it.
        </Label>
        <Label muted>Nothing here is a score, and none of it is compared to anyone else.</Label>
      </View>
    </Card>
  );
};
