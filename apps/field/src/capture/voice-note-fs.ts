import { Directory, File, Paths } from 'expo-file-system';
import type { NoteFileSystem } from './voice-note-files';

/**
 * MR-50 D — `voice-note-files.ts`'s four operations, bound to `expo-file-system` (`C9`, pinned to
 * 57.0.2: the version `expo` 57.0.12 already linked into the native build).
 *
 * Kept thin on purpose: every rule lives in `voice-note-files.ts`, where it is tested without a
 * device. This file only translates.
 */
export const expoNoteFileSystem: NoteFileSystem = {
  exists: (uri) => new File(uri).exists,
  remove: (uri) => {
    new File(uri).delete();
  },
  move: async (from, to) => {
    const destination = new File(to);
    const folder = destination.parentDirectory;
    if (!folder.exists) folder.create({ intermediates: true });
    await new File(from).move(destination);
  },
  list: (folder) => {
    const directory = new Directory(folder);
    if (!directory.exists) return [];
    return directory
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map((entry) => entry.uri);
  },
};

/** Where kept notes live, and where the recorder writes its working file. */
export const documentRoot = (): string => Paths.document.uri;
export const cacheRoot = (): string => Paths.cache.uri;
