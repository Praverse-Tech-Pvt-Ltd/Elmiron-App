import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Heading, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { StatusGlyph } from './StatusGlyph';

/**
 * Phase 4 D1 — the MR's coaching feed.
 *
 * **The ratio at the top is the most important thing on this screen.** "3 visits
 * reviewed of 42" says most visits are never looked at, and the design added it
 * against the brief on the grounds that an MR who believes every visit is analysed
 * behaves like someone under total observation. It is required, not optional: the
 * count of reviewed visits is never rendered without the total beside it.
 *
 * **There is no score, and there is no shape here that could hold one.** §3.6's
 * ban on a ranking, score, rank, percentile or grade is a regulatory line and was
 * not lifted when the coaching screens were unblocked. `trend` is a count of one
 * behaviour, in this MR's own past months, and the component has no prop for
 * anybody else's number to compare it against.
 *
 * **Rows describe findings, never a verdict on the visit.** A card carries the
 * doctor, the day, the findings in the analysis's own words, and whether the MR has
 * already replied — which is also what the manager's queue shows, so neither side
 * can act while believing the other has not been heard.
 */
export interface CoachingFinding {
  readonly id: string;
  /** True for `info` findings — what worked. */
  readonly workedWell: boolean;
  readonly summary: string;
}

export interface CoachingFeedRow {
  readonly analysisId: string;
  readonly doctorName: string;
  /** "Thu · 4:11" — the caller formats it. */
  readonly whenLabel: string;
  readonly findings: readonly CoachingFinding[];
  /** "You replied · Tue 20:10", or null when they have not. */
  readonly repliedLabel: string | null;
  /** Set when the analysis produced nothing — pending, refused or failed. */
  readonly statusNote: string | null;
}

export interface CoachingTrendPoint {
  readonly label: string;
  readonly count: number;
}

export interface CoachingFeedScreenProps {
  /** "This week" — the caller's window, not a computed one. */
  readonly periodLabel: string;
  /** "3 visits reviewed of 42". Required — see the note above. */
  readonly reviewedNote: string;
  /** The standing promise, checked against `mrViewedAt` in the contract. */
  readonly seenFirstNote: string;
  readonly rows: readonly CoachingFeedRow[];
  readonly onOpen: (analysisId: string) => void;
  readonly onReply: (analysisId: string) => void;
  /** One behaviour, this MR's own months. Absent until there is more than one. */
  readonly trend?: {
    readonly caption: string;
    readonly points: readonly CoachingTrendPoint[];
    /** Says whose numbers these are. Required alongside a trend. */
    readonly note: string;
  };
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  rows: { gap: tokens.space.sm },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  finding: { flexDirection: 'row', gap: tokens.space.sm, alignItems: 'flex-start' },
  findingText: { flex: 1 },
  actions: { flexDirection: 'row', gap: tokens.space.sm },
  half: { flex: 1 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: tokens.space.sm, height: 64 },
  bar: { flex: 1, alignItems: 'center', gap: tokens.space.xs },
  fill: {
    width: '100%',
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.offlineEdge,
  },
  fillLatest: { backgroundColor: tokens.color.accent },
});

/**
 * Bar height from a count, with the tallest bar setting the scale.
 *
 * Relative to the MR's own maximum and to nothing else — there is no axis, no
 * target line and no ceiling brought in from outside, because any of those would
 * turn a count into a measurement against a standard.
 */
const barHeight = (count: number, highest: number): number =>
  highest === 0 ? 4 : Math.max(4, Math.round((count / highest) * 44));

export const CoachingFeedScreen = ({
  periodLabel,
  reviewedNote,
  seenFirstNote,
  rows,
  onOpen,
  onReply,
  trend,
  loading = false,
  failure = null,
}: CoachingFeedScreenProps): ReactNode => {
  if (failure !== null) {
    return (
      <>
        <Heading>Coaching</Heading>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </>
    );
  }

  const highest = Math.max(0, ...(trend?.points ?? []).map((point) => point.count));

  return (
    <>
      <View style={styles.head}>
        <Heading>{periodLabel}</Heading>
        <Label muted>{reviewedNote}</Label>
      </View>

      {/*
        Rule 1, at the top and not in a policy page. `info` rather than a warning
        tone: being told this first is the ordinary state of the product, not a
        caution about it.
      */}
      <Banner detail={seenFirstNote} title="You see it first" tone="info" />

      {loading ? <Spinner label="Getting your coaching" /> : null}

      {rows.length === 0 && !loading ? (
        <Card>
          <BodyText>Nothing has been reviewed yet</BodyText>
          <Label muted>
            Most visits never are. When one is, it appears here before your manager acts on it.
          </Label>
        </Card>
      ) : null}

      <View style={styles.rows}>
        {rows.map((row) => (
          <Card key={row.analysisId}>
            <View style={styles.rowHead}>
              <Heading>{row.doctorName}</Heading>
              <Label muted>{row.whenLabel}</Label>
            </View>

            {row.statusNote === null ? (
              row.findings.map((finding) => (
                <View key={finding.id} style={styles.finding}>
                  {/*
                    The glyph reinforces the words and never replaces them — §02.
                    `success` for what worked, `attention` for what to try; neither
                    is `critical`, because a coaching note is not a failure.
                  */}
                  <StatusGlyph kind={finding.workedWell ? 'success' : 'attention'} />
                  <View style={styles.findingText}>
                    <BodyText>{finding.summary}</BodyText>
                  </View>
                </View>
              ))
            ) : (
              <Label muted>{row.statusNote}</Label>
            )}

            {row.repliedLabel === null ? null : <Label muted>{row.repliedLabel}</Label>}

            {row.statusNote === null ? (
              <View style={styles.actions}>
                <View style={styles.half}>
                  <Button
                    label="Add your reply"
                    onPress={() => {
                      onReply(row.analysisId);
                    }}
                    variant="secondary"
                  />
                </View>
                <View style={styles.half}>
                  <Button
                    label="Open it"
                    onPress={() => {
                      onOpen(row.analysisId);
                    }}
                    variant="secondary"
                  />
                </View>
              </View>
            ) : null}
          </Card>
        ))}
      </View>

      {trend === undefined ? null : (
        <Card>
          <Label muted>{trend.caption}</Label>
          <View style={styles.bars}>
            {trend.points.map((point, index) => (
              <View key={point.label} style={styles.bar}>
                <View
                  // The most recent month is the accent one. That is recency, not
                  // achievement — there is no "good" height on this chart.
                  style={[
                    styles.fill,
                    { height: barHeight(point.count, highest) },
                    index === trend.points.length - 1 ? styles.fillLatest : null,
                  ]}
                />
                <Label muted>{point.label}</Label>
              </View>
            ))}
          </View>
          {/*
            The counts in words as well as bars: a bar chart with no numbers is a
            shape an MR can read a ranking into.
          */}
          <BodyText>
            {trend.points.map((point) => `${point.label} ${String(point.count)}`).join(' · ')}
          </BodyText>
          <Label muted>{trend.note}</Label>
        </Card>
      )}
    </>
  );
};
