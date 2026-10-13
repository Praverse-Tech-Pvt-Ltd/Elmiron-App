/**
 * `FE-W86` — work that must happen while the session still exists, just before sign-out.
 *
 * The push provider registers one step here (retire this phone's token for the person leaving); the
 * session's `signOut` runs it first. With push off nothing is registered and this is a no-op. A step
 * never blocks sign-out: it is bounded by its own timeout, and a failure is swallowed -- a rep on a
 * shared phone with no signal must still be able to sign out.
 */
let step: (() => Promise<unknown>) | null = null;

/** Set (or clear, with null) the one step. Returns a function that clears it if it is still this one. */
export const setBeforeSignOut = (next: (() => Promise<unknown>) | null): (() => void) => {
  step = next;
  return () => {
    if (step === next) step = null;
  };
};

export const runBeforeSignOut = async (): Promise<void> => {
  const current = step;
  if (current === null) return;
  try {
    await current();
  } catch {
    // Deliberately nothing: see the note above.
  }
};
