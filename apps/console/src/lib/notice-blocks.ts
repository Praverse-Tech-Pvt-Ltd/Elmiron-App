/**
 * `FE-W167` — the live location notice, laid out as its author wrote it.
 *
 * The notice body is Markdown, hard-wrapped at about 100 characters. `/tracking/notice` showed it in
 * a pre-wrapped box, so an admin approving a notice read `##`, `**`, backticks and `---` rules, with
 * sentences broken wherever the source file wrapped — and approved what they could barely read.
 *
 * The field app solved the same thing for reps (`FE-W162`, `apps/field/src/tracking/notice-blocks.ts`).
 * This is the console's own copy of that idea rather than an import across apps, with two
 * differences an approver needs:
 *
 * - **a `[[ … ]]` blank is kept and marked**, never removed: it is a decision the company has not
 *   made, and the approver is the last person who can notice it is still there; and
 * - a `>` quote and a numbered list are read as a paragraph and a list, because the built-in draft
 *   uses both.
 *
 * **The wording is never changed.** Only Markdown's own markers go (`#`, `**`, `*`, backticks, `>`,
 * a `---` rule, a list marker, a leading `[ ]`); every word is still there, in order. A body with no
 * Markdown at all renders as the paragraphs it already had.
 */

export type NoticeBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'bullets'; readonly items: readonly string[] };

const BULLET = /^\s*(?:[-*•]|\d{1,3}[.)])\s+/u;
const HEADING = /^\s*#{1,6}\s+/u;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u;
const QUOTE = /^\s*>\s?/u;

/** Markdown's inline markers off, the words left: `**bold**`, `*em*`, `` `code` ``, a leading `[ ]`. */
export const plainInline = (text: string): string =>
  text
    .replace(/\*\*(.+?)\*\*/gu, '$1')
    .replace(/^\s*\[\s?[xX]?\s?\]\s+/u, '')
    .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/gu, '$1$2')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();

export const noticeBlocks = (body: string): NoticeBlock[] => {
  const blocks: NoticeBlock[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = (): void => {
    const text = plainInline(paragraph.join(' '));
    if (text !== '') blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  };
  const flushBullets = (): void => {
    const items = bullets.map(plainInline).filter((item) => item !== '');
    if (items.length > 0) blocks.push({ kind: 'bullets', items });
    bullets = [];
  };

  for (const raw of body.replace(/\r\n?/gu, '\n').split('\n')) {
    // A quoted line is read as the line it quotes; an empty `>` line ends a paragraph like a blank.
    const line = raw.replace(QUOTE, '');
    if (line.trim() === '' || RULE.test(line)) {
      flushParagraph();
      flushBullets();
    } else if (HEADING.test(line)) {
      flushParagraph();
      flushBullets();
      const text = plainInline(line.replace(HEADING, ''));
      if (text !== '') blocks.push({ kind: 'heading', text });
    } else if (BULLET.test(line) && !/^\s*\*\*/u.test(line)) {
      // A new item. (A line opening `**` is bold text, not a `*` bullet.)
      flushParagraph();
      bullets.push(line.replace(BULLET, ''));
    } else if (bullets.length > 0 && /^\s+\S/u.test(line)) {
      // An indented line continues the item it was wrapped from.
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1] ?? ''} ${line.trim()}`;
    } else {
      flushBullets();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushBullets();
  return blocks;
};

/**
 * A block's text cut where a `[[ … ]]` blank starts and ends, so the renderer can mark each blank.
 * Joined back together, the pieces are the text exactly.
 */
export const blankPieces = (
  text: string,
): readonly { readonly text: string; readonly blank: boolean }[] =>
  text
    .split(/(\[\[[^\]]*\]\])/u)
    .filter((piece) => piece !== '')
    .map((piece) => ({ text: piece, blank: /^\[\[[^\]]*\]\]$/u.test(piece) }));
