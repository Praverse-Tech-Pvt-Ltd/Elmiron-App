import { describe, expect, it } from 'vitest';
import {
  NotYourNoteError,
  assertOwned,
  discardNote,
  keepNote,
  listNotes,
  noteFolder,
  sweepUnsaved,
} from './voice-note-files';
import type { NoteFileSystem } from './voice-note-files';

/**
 * MR-50 D2, D3 — the voice-note file rules, with an in-memory file system.
 *
 * The emulator proves the same things against real files (PROJECT-OVERVIEW → MR-50 D); these pin
 * each rule so a change to one fails a named case.
 */
const DOC = 'file:///data/user/0/com.praversetech.fieldforce/files/';
const CACHE = 'file:///data/user/0/com.praversetech.fieldforce/cache/';
const REP_A = 'b95aa032-bd5e-4bb8-8b37-44696c6d6cc1';
const REP_B = '15bdcba4-c551-427a-9b9f-26fef821b64e';

const memoryFs = (initial: readonly string[] = []): NoteFileSystem & { files: Set<string> } => {
  const files = new Set(initial);
  return {
    files,
    exists: (uri) => files.has(uri),
    remove: (uri) => {
      files.delete(uri);
    },
    move: (from, to) => {
      if (!files.has(from)) return Promise.reject(new Error(`no such file ${from}`));
      files.delete(from);
      files.add(to);
      return Promise.resolve();
    },
    list: (folder) =>
      [...files].filter((uri) => uri.startsWith(folder) && !uri.slice(folder.length).includes('/')),
  };
};

const recorderFile = (id: string): string => `${CACHE}Audio/recording-${id}.m4a`;

describe('D2 — discarded audio leaves the phone', () => {
  it('"Start again" deletes the unsaved recording', () => {
    const fs = memoryFs([recorderFile('one')]);
    discardNote(fs, recorderFile('one'));
    expect(fs.files.size).toBe(0);
  });

  it('never deletes anything that is not the recorder’s working file — a kept note survives', () => {
    const kept = `${noteFolder(DOC, REP_A)}note-1.m4a`;
    const fs = memoryFs([kept]);
    discardNote(fs, kept);
    expect(fs.files.has(kept)).toBe(true);
  });

  it('sweeps every unsaved recording left in the cache when the screen opens', () => {
    const other = `${CACHE}Audio/not-a-recording.txt`;
    const fs = memoryFs([recorderFile('a'), recorderFile('b'), other]);
    expect(sweepUnsaved(fs, CACHE)).toEqual([recorderFile('a'), recorderFile('b')]);
    // Positive control: the sweep is selective, not a wipe.
    expect([...fs.files]).toEqual([other]);
  });
});

describe('Save keeps the note, in the rep’s own folder', () => {
  it('moves the recording out of the cache into the signed-in rep’s folder', async () => {
    const fs = memoryFs([recorderFile('one')]);
    const at = await keepNote(fs, DOC, REP_A, recorderFile('one'), 'note-1');
    expect(at).toBe(`${DOC}voice-notes/${REP_A}/note-1.m4a`);
    expect([...fs.files]).toEqual([at]);
  });

  it('is not swept afterwards — kept means kept', async () => {
    const fs = memoryFs([recorderFile('one')]);
    const at = await keepNote(fs, DOC, REP_A, recorderFile('one'), 'note-1');
    sweepUnsaved(fs, CACHE);
    expect(fs.files.has(at)).toBe(true);
  });
});

describe('D3 — a note belongs to the rep who recorded it', () => {
  it('lists rep A’s note for rep A — the positive control', async () => {
    const fs = memoryFs([recorderFile('one')]);
    const at = await keepNote(fs, DOC, REP_A, recorderFile('one'), 'note-1');
    expect(listNotes(fs, DOC, REP_A)).toEqual([at]);
  });

  it('shows rep B nothing of rep A’s on the same phone', async () => {
    const fs = memoryFs([recorderFile('one')]);
    await keepNote(fs, DOC, REP_A, recorderFile('one'), 'note-1');
    expect(listNotes(fs, DOC, REP_B)).toEqual([]);
  });

  it('refuses rep B’s session opening rep A’s note by its path', async () => {
    const fs = memoryFs([recorderFile('one')]);
    const at = await keepNote(fs, DOC, REP_A, recorderFile('one'), 'note-1');
    expect(() => {
      assertOwned(at, DOC, REP_B);
    }).toThrow(NotYourNoteError);
    expect(() => {
      assertOwned(at, DOC, REP_A);
    }).not.toThrow();
  });

  it('cannot be walked out of: a user id with "../" stays one folder name', () => {
    expect(noteFolder(DOC, '../' + REP_A)).toBe(`${DOC}voice-notes/..%2F${REP_A}/`);
    expect(() => {
      assertOwned(`${noteFolder(DOC, REP_B)}../${REP_A}/note-1.m4a`, DOC, REP_B);
    }).toThrow(NotYourNoteError);
  });
});
