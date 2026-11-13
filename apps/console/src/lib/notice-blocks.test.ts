import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blankPieces, noticeBlocks } from './notice-blocks';

const SAMPLE = [
  '> **Status: DRAFT.** Read it before',
  '> approving.',
  '',
  '---',
  '',
  '## Location sharing — notice',
  '',
  '**From:** `[[ BLANK: registered legal name ]]` ("the Company")',
  '',
  '### When it is shared',
  '',
  '* **Only during your working hours**, as set: `[[ shown from the server, e.g.',
  '  09:00–18:00 ]]`.',
  '* It stops at the end of the day.',
  '1. First numbered point.',
  '',
  'A paragraph wrapped',
  'across two lines.',
].join('\n');

describe('FE-W167 — the notice read as its author laid it out', () => {
  it('turns Markdown into headings, paragraphs and lists, joining wrapped lines', () => {
    expect(noticeBlocks(SAMPLE)).toEqual([
      { kind: 'paragraph', text: 'Status: DRAFT. Read it before approving.' },
      { kind: 'heading', text: 'Location sharing — notice' },
      { kind: 'paragraph', text: 'From: [[ BLANK: registered legal name ]] ("the Company")' },
      { kind: 'heading', text: 'When it is shared' },
      {
        kind: 'bullets',
        items: [
          'Only during your working hours, as set: [[ shown from the server, e.g. 09:00–18:00 ]].',
          'It stops at the end of the day.',
          'First numbered point.',
        ],
      },
      { kind: 'paragraph', text: 'A paragraph wrapped across two lines.' },
    ]);
  });

  it('keeps a text with no Markdown as the paragraphs it already had', () => {
    expect(noticeBlocks('First paragraph.\n\nSecond one.')).toEqual([
      { kind: 'paragraph', text: 'First paragraph.' },
      { kind: 'paragraph', text: 'Second one.' },
    ]);
  });

  it('cuts a blank out of its sentence so it can be marked, losing nothing', () => {
    const text = 'Kept for [[ BLANK: retention period ]], then deleted.';
    const pieces = blankPieces(text);
    expect(pieces).toEqual([
      { text: 'Kept for ', blank: false },
      { text: '[[ BLANK: retention period ]]', blank: true },
      { text: ', then deleted.', blank: false },
    ]);
    expect(pieces.map((p) => p.text).join('')).toBe(text);
  });

  const draft = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../docs/operator/live-tracking-notice-DRAFT.md',
  );

  it.runIf(existsSync(draft))('keeps every word of the built-in draft, in order', () => {
    const source = readFileSync(draft, 'utf8');
    // Letters and digits only, after the source's own list markers are taken off: punctuation
    // that sat beside a removed `**` is not a word, and neither is a "1." list marker.
    const wordsOf = (text: string): string[] =>
      text.replace(/^\s*(?:>\s*)?(?:\d{1,3}[.)]|[-*•])\s+/gmu, ' ').match(/[\p{L}\p{N}]+/gu) ?? [];
    const rendered = noticeBlocks(source)
      .map((b) => (b.kind === 'bullets' ? b.items.join(' ') : b.text))
      .join(' ');
    expect(wordsOf(rendered)).toEqual(wordsOf(source));
  });
});
