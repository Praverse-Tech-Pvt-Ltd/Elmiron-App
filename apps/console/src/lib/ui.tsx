import type { ReactNode } from 'react';
import { Icon } from './icons';

/**
 * The console's element set — small, deliberate, and not `packages/ui`.
 *
 * `@fieldforce/ui` is React Native. Rendering it here would mean `react-native-web`
 * and a second rendering target to keep working for the life of the product, for
 * components whose whole design brief ("one thumb, 60pt targets, the reach zone")
 * is about a phone. Phase 4 asks for the same *tokens* at compact density, not the
 * same components, so this file is that.
 *
 * `FE-W120`: every element here is styled by a class from `theme-css.ts`, which is generated from
 * the tokens — so a colour, radius or type size still cannot appear here that the token tests have
 * not checked, and hover, focus and the tablet layout now apply to these elements too, which
 * inline styles could not do.
 *
 * **The element types are load-bearing.** A `Card` is a `<section>` with its children directly
 * inside it, a `Heading` is an `<h2>` and a `Title` an `<h1>`: the browser suite finds a card as
 * "the section that has this heading", so a wrapper `<div>` around a heading would change what
 * those tests select.
 */

const cx = (...names: readonly (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

export const Title = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <h1 className="ff-title">{children}</h1>
);

export const Heading = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <h2 className="ff-heading">{children}</h2>
);

export const Body = ({
  children,
  muted = false,
}: {
  readonly children: ReactNode;
  readonly muted?: boolean;
}): ReactNode => <p className={cx('ff-text', muted && 'ff-text-muted')}>{children}</p>;

export const Label = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <span className="ff-label">{children}</span>
);

export const Figure = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <span className="ff-figure">{children}</span>
);

export const Card = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <section className="ff-card">{children}</section>
);

/**
 * `FE-W120` — the page frame every screen uses: one width, one rhythm between blocks.
 *
 * `width` is the reading measure the page asked for before, kept per page: 1320 for the tables,
 * 1100 for the live-location list, 900 for a single record.
 */
export const Page = ({
  children,
  width = 'wide',
}: {
  readonly children: ReactNode;
  readonly width?: 'wide' | 'medium' | 'narrow';
}): ReactNode => (
  <div
    className={cx(
      'ff-page',
      width === 'medium' && 'ff-page-medium',
      width === 'narrow' && 'ff-page-narrow',
    )}
  >
    {children}
  </div>
);

/**
 * `FE-W120` — the page header: the title, its one-line description, and the page's own action at
 * the right when it has one. The description keeps the words each page already had.
 */
export const PageHeader = ({
  title,
  eyebrow,
  children,
  actions,
}: {
  readonly title: ReactNode;
  /** A small line above the title — the record a review page is about. */
  readonly eyebrow?: ReactNode;
  /** The description, as one or more `Body` paragraphs. */
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}): ReactNode => (
  <header className="ff-page-header">
    <div className="ff-page-header-text">
      {eyebrow === undefined ? null : <Label>{eyebrow}</Label>}
      <Title>{title}</Title>
      {children}
    </div>
    {actions === undefined ? null : <div className="ff-page-actions">{actions}</div>}
  </header>
);

/**
 * Side-by-side panels that stack when the window is narrower than two of them. Each child is a
 * column; give one `ff-col-wide` to make it the larger.
 */
export const Columns = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <div className="ff-columns">{children}</div>
);

/** A labelled figure — a count the database returned, on a tile. */
export const Stat = ({
  label,
  children,
  note,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
  readonly note?: ReactNode;
}): ReactNode => (
  <div className="ff-stat">
    <Label>{label}</Label>
    <Figure>{children}</Figure>
    {note === undefined ? null : <Body muted>{note}</Body>}
  </div>
);

export const Stats = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <div className="ff-stats">{children}</div>
);

type Tone = 'success' | 'neutral' | 'attention' | 'info' | 'critical';

/**
 * A status pill.
 *
 * `tone` maps onto the semantic tokens rather than taking a colour, so a new state
 * cannot introduce an unchecked pair: every fill here is already in
 * `requiredContrastPairs`.
 */
export const Pill = ({
  children,
  tone,
}: {
  readonly children: ReactNode;
  readonly tone: Tone;
}): ReactNode => <span className={`ff-pill ff-pill-${tone}`}>{children}</span>;

/**
 * A note about something the console cannot show — or a refusal, or a caution.
 *
 * Used where a panel in the Phase 4 design has no endpoint behind it. It is a
 * visible, explained gap rather than a plausible-looking number, which is the same
 * rule the field app follows for the mileage rupee figure and the UCPMP cap.
 *
 * `FE-W120`: each tone now carries its own glyph beside the words, and a critical note a bar down
 * its edge, so a refusal reads as a refusal at a glance and not only by its tint.
 */
export const MissingNote = ({
  children,
  tone = 'attention',
}: {
  readonly children: ReactNode;
  /**
   * UX polish. One amber box carried everything -- the permanent advisory, four-eyes explanations,
   * empty states AND request failures -- so a real failure looked exactly like a disclaimer and
   * nobody read either. `critical` is a failure or a refusal, announced to screen readers
   * (`role="alert"`); `info` is an explanation that needs nothing done; `attention` stays the
   * default for everything else.
   */
  readonly tone?: 'attention' | 'critical' | 'info';
}): ReactNode => (
  <div className={`ff-note ff-note-${tone}`} role={tone === 'critical' ? 'alert' : 'note'}>
    <Icon name={tone} size={18} />
    <div className="ff-note-body">{children}</div>
  </div>
);

/**
 * UX polish. A content version's status in words, with the tone that says whether anything is
 * waiting: "In review" is the one that needs a person, so it is the one in the attention tone.
 * The raw enum (`in_review`) stays on the element as `data-status` for anything that needs the
 * machine value; people read the words.
 */
const STATUS_WORDS: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = {
  draft: { label: 'Draft', tone: 'neutral' },
  in_review: { label: 'In review', tone: 'attention' },
  approved: { label: 'Approved', tone: 'success' },
  published: { label: 'Published', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  retired: { label: 'Retired', tone: 'neutral' },
  superseded: { label: 'Superseded', tone: 'neutral' },
};

export const StatusPill = ({ status }: { readonly status: string }): ReactNode => {
  const known = STATUS_WORDS[status];
  return (
    <span data-status={status} style={{ display: 'inline-flex' }}>
      <Pill tone={known?.tone ?? 'neutral'}>{known?.label ?? status.replace(/_/gu, ' ')}</Pill>
    </span>
  );
};
