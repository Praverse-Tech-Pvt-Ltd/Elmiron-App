/**
 * MR-50 D — voice-note audio on the phone, KEPT (`C9`), and owned by the rep who recorded it.
 *
 * `expo-audio` writes every recording to `cache/Audio/recording-<uuid>.m4a` while the MR is still
 * speaking, before anybody presses Save. MR-47 measured on the emulator that nothing ever deleted
 * those files: not "Start again", not leaving the screen, not a restart, not sign-out. `C9` keeps
 * voice notes, so the rule becomes:
 *
 * - **Kept** — Save MOVES the file out of the cache into `document/voice-notes/<userId>/`, where
 *   it belongs to the signed-in rep. The cache is the OS's to clear; a kept note must not be.
 * - **Discarded** — "Start again", recording over it, and leaving without saving DELETE it.
 * - **Leftovers** — anything still in `cache/Audio` when the screen opens (a crash, a force-stop
 *   mid-recording, files from before this change) is audio nobody kept, and is swept.
 * - **Owned** — every path this module opens is checked to be inside the signed-in rep's folder,
 *   so a second rep's session cannot list or read the first rep's notes. Same rule the offline
 *   queue has had since MR-49 (`sync.queue.v1.<userId>`).
 *
 * The file system is injected so every rule here is tested without a device; `voice-note-fs.ts`
 * binds it to `expo-file-system`.
 */

/** The four operations the rules need, and nothing else. URIs are `file://…` strings. */
export interface NoteFileSystem {
  readonly exists: (uri: string) => boolean;
  readonly remove: (uri: string) => void;
  /** Move `from` to exactly `to`, creating `to`'s folder if needed. Asynchronous on the device. */
  readonly move: (from: string, to: string) => Promise<void>;
  /** File URIs directly inside `folder`; empty when it does not exist. */
  readonly list: (folder: string) => readonly string[];
}

const withSlash = (uri: string): string => (uri.endsWith('/') ? uri : `${uri}/`);

/**
 * The rep's own folder. The id is encoded so no user id can reach outside it — `..` or a `/` in an
 * id becomes part of one folder name, never a path step.
 */
export const noteFolder = (documentRoot: string, userId: string): string =>
  `${withSlash(documentRoot)}voice-notes/${encodeURIComponent(userId)}/`;

/** Only `recording-*.m4a` directly in the cache's `Audio/` folder is the recorder's working file. */
const RECORDER_FILE = /\/Audio\/recording-[^/]+\.m4a$/u;

export class NotYourNoteError extends Error {
  constructor(uri: string) {
    super(`This note is not in the signed-in rep's folder: ${uri}`);
    this.name = 'NotYourNoteError';
  }
}

/**
 * Refuses any path outside the signed-in rep's folder. Every read and delete of a KEPT note goes
 * through here, so another rep's session has no way in.
 */
export const assertOwned = (uri: string, documentRoot: string, userId: string): void => {
  const folder = noteFolder(documentRoot, userId);
  const rest = uri.startsWith(folder) ? uri.slice(folder.length) : null;
  if (rest === null || rest.length === 0 || rest.includes('/') || rest.includes('..')) {
    throw new NotYourNoteError(uri);
  }
};

/** Save: move the recorder's working file into the rep's folder. Returns where it now lives. */
export const keepNote = async (
  fs: NoteFileSystem,
  documentRoot: string,
  userId: string,
  recorderUri: string,
  noteId: string,
): Promise<string> => {
  const to = `${noteFolder(documentRoot, userId)}${encodeURIComponent(noteId)}.m4a`;
  await fs.move(recorderUri, to);
  return to;
};

/** Start again / record over / leave without saving: the unsaved audio goes. */
export const discardNote = (fs: NoteFileSystem, recorderUri: string | null): void => {
  if (recorderUri !== null && RECORDER_FILE.test(recorderUri) && fs.exists(recorderUri)) {
    fs.remove(recorderUri);
  }
};

/**
 * On opening the screen, before any recording starts: every recorder working file still in the
 * cache was never kept. Returns what was removed, so the caller can say so in a test or a log.
 */
export const sweepUnsaved = (fs: NoteFileSystem, cacheRoot: string): readonly string[] => {
  const orphans = fs.list(`${withSlash(cacheRoot)}Audio/`).filter((uri) => RECORDER_FILE.test(uri));
  for (const uri of orphans) fs.remove(uri);
  return orphans;
};

/**
 * MR-52 C2 — notes saved before the upload existed, which can NEVER be sent.
 *
 * **Why they cannot be sent, rather than "are not yet".** A kept file is named by its note id and
 * nothing else; the VISIT it belongs to lives in the queue row (`voiceNoteQueueItem`). A note saved
 * before MR-51 D has no queue row, so the visit is gone — and `begin_upload` takes a visit. There is
 * no repair: the audio exists and the fact it documents does not.
 *
 * **So the choice is delete-and-say, not upload.** Leaving them is the third option and the worst:
 * audio sitting on a phone forever, which the notice would then have to describe and nobody could
 * act on. The rep is told how many went, on the screen that owns these files.
 *
 * `queuedNoteIds` is what the rep's own outbox holds. A note uploaded seconds ago is not in either
 * set, and is not here either — `uploadVoiceNote` deletes the file the moment the server takes it.
 */
export const unsendableNotes = (
  fs: NoteFileSystem,
  documentRoot: string,
  userId: string,
  queuedNoteIds: readonly string[],
): readonly string[] => {
  const queued = new Set(queuedNoteIds.map((id) => encodeURIComponent(id)));
  return listNotes(fs, documentRoot, userId).filter((uri) => {
    const name = uri.slice(noteFolder(documentRoot, userId).length);
    return !queued.has(name.replace(/\.m4a$/u, ''));
  });
};

/** Removes them, and returns how many went, so the caller can say so rather than guess. */
export const removeUnsendableNotes = (
  fs: NoteFileSystem,
  documentRoot: string,
  userId: string,
  queuedNoteIds: readonly string[],
): number => {
  const doomed = unsendableNotes(fs, documentRoot, userId, queuedNoteIds);
  for (const uri of doomed) fs.remove(uri);
  return doomed.length;
};

/** The signed-in rep's kept notes — and only theirs. */
export const listNotes = (
  fs: NoteFileSystem,
  documentRoot: string,
  userId: string,
): readonly string[] =>
  fs.list(noteFolder(documentRoot, userId)).filter((uri) => {
    try {
      assertOwned(uri, documentRoot, userId);
      return true;
    } catch {
      return false;
    }
  });
