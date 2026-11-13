/**
 * `FE-W162` — the live location notice, read as its author laid it out.
 *
 * The notice body is the server's published text, written in Markdown and hard-wrapped at about 100
 * characters (`docs/operator/live-tracking-notice-DRAFT.md` is the engineering draft). It was shown as
 * ONE `BodyText`, so a rep read `##`, `**`, backticks, a `---` rule and a `[ ]` box, with every
 * sentence broken where the source file happened to wrap — on a phone, a broken page.
 *
 * **The wording is never changed.** This splits the text into headings, paragraphs and bullets, joins
 * the lines a paragraph was wrapped across, and removes only Markdown's own markers: `#`, `**`, `*`,
 * backticks, a `---` rule, and a leading `[ ]` (the app has its own "I agree" button; a box drawn in
 * text cannot be ticked). Every word of the notice is still on the screen, in order. A body with no
 * Markdown renders as the paragraphs it already had.
 */

export type NoticeBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'bullets'; readonly items: readonly string[] };

const BULLET = /^\s*[-*•]\s+/u;
const HEADING = /^\s*#{1,6}\s+/u;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u;

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

  for (const line of body.replace(/\r\n?/gu, '\n').split('\n')) {
    if (line.trim() === '' || RULE.test(line)) {
      flushParagraph();
      flushBullets();
    } else if (HEADING.test(line)) {
      flushParagraph();
      flushBullets();
      const text = plainInline(line.replace(HEADING, ''));
      if (text !== '') blocks.push({ kind: 'heading', text });
    } else if (BULLET.test(line) && !/^\s*\*\*/u.test(line)) {
      // A new bullet. (A line opening `**` is bold text, not a `*` bullet.)
      flushParagraph();
      bullets.push(line.replace(BULLET, ''));
    } else if (bullets.length > 0 && /^\s+\S/u.test(line)) {
      // An indented line continues the bullet it was wrapped from.
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
