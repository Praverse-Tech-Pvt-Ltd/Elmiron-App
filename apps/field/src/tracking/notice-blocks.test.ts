import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { noticeBlocks, plainInline } from './notice-blocks';
import type { NoticeBlock } from './notice-blocks';

/** `FE-W162` — the live location notice laid out, with every word kept. */

/** The words a reader sees: Markdown's markers deleted, a text checkbox and a rule dropped. */
const words = (text: string): string[] =>
  text
    .replace(/\[ \]/gu, ' ')
    .replace(/[#*`]/gu, '')
    .split(/\s+/u)
    .filter((word) => word !== '' && !/^-{3,}$/u.test(word));

const blockText = (blocks: readonly NoticeBlock[]): string =>
  blocks.map((block) => (block.kind === 'bullets' ? block.items.join(' ') : block.text)).join(' ');

describe('noticeBlocks', () => {
  it('headings, paragraphs joined across their wrapped lines, and bullets', () => {
    const blocks = noticeBlocks(
      [
        '## Location sharing',
        '',
        'This is a **separate** notice from any other',
        'you have agreed to.',
        '',
        '### When',
        '',
        '* **Only during your working hours**, as set for',
        '  your territory.',
        '* It stops automatically.',
      ].join('\n'),
    );
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Location sharing' },
      { kind: 'paragraph', text: 'This is a separate notice from any other you have agreed to.' },
      { kind: 'heading', text: 'When' },
      {
        kind: 'bullets',
        items: [
          'Only during your working hours, as set for your territory.',
          'It stops automatically.',
        ],
      },
    ]);
  });

  it('drops the rule and the text checkbox, keeping the sentence', () => {
    expect(noticeBlocks('---\n\n**[ ] I have read this notice and agree.**')).toEqual([
      { kind: 'paragraph', text: 'I have read this notice and agree.' },
    ]);
  });

  it('a line opening with bold text is a paragraph, not a bullet', () => {
    expect(noticeBlocks('**You can withdraw at any time** from settings.')).toEqual([
      { kind: 'paragraph', text: 'You can withdraw at any time from settings.' },
    ]);
  });

  it('plain text with no Markdown stays the paragraphs it had', () => {
    expect(noticeBlocks('One.\n\nTwo.')).toEqual([
      { kind: 'paragraph', text: 'One.' },
      { kind: 'paragraph', text: 'Two.' },
    ]);
  });

  it('THE DRAFT NOTICE: every word survives, in order, and no Markdown marker is left', () => {
    const draft = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'docs', 'operator', 'live-tracking-notice-DRAFT.md'),
      'utf8',
    );
    const body = draft.slice(draft.indexOf('## '));
    const blocks = noticeBlocks(body);
    expect(words(blockText(blocks))).toEqual(words(body));
    const shown = blockText(blocks);
    expect(shown).not.toMatch(/\*\*|`|^#|\[ \]/u);
    expect(blocks.filter((block) => block.kind === 'heading').length).toBeGreaterThanOrEqual(6);
  });
});

describe('plainInline', () => {
  it('removes bold, emphasis and code markers only', () => {
    expect(plainInline('*Version: DRAFT* — `[[ BLANK: x ]]` and **this**')).toBe(
      'Version: DRAFT — [[ BLANK: x ]] and this',
    );
  });
});
