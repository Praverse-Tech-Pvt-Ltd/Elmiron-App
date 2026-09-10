import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SyncQueueItemSchema, SyncRejectionCodeSchema } from '@fieldforce/core';
import { LONG_RETRY_AFTER_ATTEMPTS, QueueScreen, rowStateFor } from './QueueScreen';
import type { QueueScreenRejection } from './QueueScreen';

/**
 * Inputs are parsed through `@fieldforce/core`'s Zod schemas rather than written as
 * literals. A hand-written fixture that drifts from the contract still passes; a
 * parse that drifts throws. The shapes are tied to the contract by construction.
 */
const item = (over: Partial<ReturnType<typeof SyncQueueItemSchema.parse>> = {}) =>
  SyncQueueItemSchema.parse({
    id: '15151515-1515-4515-8515-151515151501',
    entity: 'visit',
    operation: 'create',
    entityId: '15151515-1515-4515-8515-1515151515aa',
    payload: {},
    status: 'queued',
    attemptCount: 0,
    lastError: null,
    clientCreatedAt: '2026-08-17T09:00:00.000Z',
    syncedAt: null,
    ...over,
  });

const rejection = (over: Partial<QueueScreenRejection> = {}): QueueScreenRejection => ({
  // The code is parsed too, so a code Backend removes fails here rather than
  // rendering as an unknown string.
  code: SyncRejectionCodeSchema.parse('outside_shift_window'),
  explanation: 'This visit was recorded outside your territory working hours.',
  // MR-17 B1. Null by default so the existing cases keep asserting the SERVER's sentence
  // alone; the remedy has its own cases below.
  remedy: null,
  deadLettered: false,
  receivedAt: '2026-08-17T11:22:33.000Z',
  ...over,
});

describe('the empty state', () => {
  it('reads as reassuring rather than as an error or a failure', async () => {
    // Nothing waiting is the GOOD outcome. An empty queue styled as a problem
    // teaches an MR that the screen's warnings mean nothing.
    await render(<QueueScreen items={[]} rejections={{}} />);
    expect(screen.getByText('Everything is sent')).toBeTruthy();
    expect(screen.getByText('Nothing is waiting to leave this phone.')).toBeTruthy();
  });

  it('treats a fully synced queue as empty, not as four invisible rows', async () => {
    const sent = item({ status: 'synced', syncedAt: '2026-08-17T10:00:00.000Z' });
    await render(<QueueScreen items={[sent]} rejections={{}} />);
    expect(screen.getByText('Everything is sent')).toBeTruthy();
  });
});

describe('the five states each carry a text label, not colour alone', () => {
  // Objects rather than tuples: it.each with `as const` tuples produces a strict
  // per-case argument signature that a destructured callback does not satisfy.
  it.each([
    { label: 'Waiting to send', attemptCount: 0, refused: false },
    { label: 'Still trying', attemptCount: LONG_RETRY_AFTER_ATTEMPTS, refused: false },
    { label: 'Refused', attemptCount: 1, refused: true },
  ])('renders the label "$label"', async ({ label, attemptCount, refused }) => {
    const queued = item({ attemptCount });
    await render(
      <QueueScreen items={[queued]} rejections={refused ? { [queued.id]: rejection() } : {}} />,
    );
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('labels a dead letter and says it is reversible', async () => {
    const queued = item();
    await render(
      <QueueScreen
        items={[queued]}
        rejections={{ [queued.id]: rejection({ deadLettered: true }) }}
      />,
    );
    expect(screen.getByText('Needs someone to look')).toBeTruthy();
    expect(screen.getByText('This can be sent again once someone reviews it.')).toBeTruthy();
  });
});

describe("the server's sentence", () => {
  it('renders verbatim, with nothing wrapped around it', async () => {
    const queued = item();
    const sentence = 'This visit was recorded outside your territory working hours.';
    await render(<QueueScreen items={[queued]} rejections={{ [queued.id]: rejection() }} />);
    // getByText is an exact match by default, so a prefix, suffix or reworded
    // variant fails this assertion rather than passing a substring check.
    expect(screen.getByText(sentence)).toBeTruthy();
  });

  it('shows no sentence at all when the server sent none, rather than inventing one', async () => {
    const queued = item();
    await render(
      <QueueScreen
        items={[queued]}
        rejections={{ [queued.id]: rejection({ explanation: null }) }}
      />,
    );
    expect(screen.getByText('Refused')).toBeTruthy();
    expect(screen.queryByText(/working hours/u)).toBeNull();
  });
});

describe('timestamps', () => {
  it('shows the server clock and computes no duration', async () => {
    // The only timestamp on this screen is RejectionRecord.receivedAt, the server's
    // own. Nothing here reads the device clock, so nothing can render "3 hours ago"
    // from a machine whose clock has drifted.
    const queued = item();
    await render(<QueueScreen items={[queued]} rejections={{ [queued.id]: rejection() }} />);
    expect(screen.getByText('Server recorded this at 2026-08-17T11:22:33.000Z')).toBeTruthy();
  });

  it('shows no time at all for an item the server has never seen', async () => {
    // A queued item has no server timestamp — clientCreatedAt is the device's, and
    // rendering it as though the server knew about the work would be a lie.
    await render(<QueueScreen items={[item({ attemptCount: 9 })]} rejections={{}} />);
    expect(screen.queryByText(/Server recorded this at/u)).toBeNull();
    expect(screen.queryByText(/2026-08-17T09:00/u)).toBeNull();
  });
});

describe('the long-retry threshold is display only', () => {
  it('changes the words and nothing about the item', () => {
    // The server owns the outcome. Crossing a client-side display threshold must not
    // promote, demote or retire anything — the item is byte-identical either side of
    // it, and only the sentence the MR reads changes.
    const below = item({ attemptCount: LONG_RETRY_AFTER_ATTEMPTS - 1 });
    const above = { ...below, attemptCount: LONG_RETRY_AFTER_ATTEMPTS };

    expect(rowStateFor(below, undefined)).toBe('waiting');
    expect(rowStateFor(above, undefined)).toBe('waiting-long');

    // Same status, same identity. The threshold read the count; it changed nothing.
    expect(above.status).toBe(below.status);
    expect(above.id).toBe(below.id);
  });

  it('does not move a row that crosses it', async () => {
    // Position is read as priority, and priority is a verdict. Rows render in the
    // order given, so a long-waiting item stays exactly where the server's order put
    // it rather than being floated to the top as though it mattered more.
    const first = item({ id: '15151515-1515-4515-8515-151515151501', attemptCount: 0 });
    const second = item({
      id: '15151515-1515-4515-8515-151515151502',
      entity: 'check_in',
      attemptCount: LONG_RETRY_AFTER_ATTEMPTS + 5,
    });

    await render(<QueueScreen items={[first, second]} rejections={{}} />);

    const labels = screen.getAllByText(/Waiting to send|Still trying/u);
    expect(labels).toHaveLength(2);
    expect(labels[0]?.props['children']).toBe('Waiting to send');
    expect(labels[1]?.props['children']).toBe('Still trying');
  });

  it('never turns a long wait into a refusal', async () => {
    // No number of attempts is a verdict. Only the server saying so makes a refusal,
    // and a client that invents one tells the MR their work is lost when it is not.
    const stubborn = item({ attemptCount: 500 });
    expect(rowStateFor(stubborn, undefined)).toBe('waiting-long');

    await render(<QueueScreen items={[stubborn]} rejections={{}} />);
    expect(screen.queryByText('Refused')).toBeNull();
    expect(screen.queryByText('Needs someone to look')).toBeNull();
  });
});

describe('the glyph is decorative', () => {
  it('is invisible to the accessibility tree, so the label is what gets announced', async () => {
    // The strongest available proof, and it is the query engine's own: RTL skips
    // accessibility-hidden elements by default, so a glyph that IS hidden simply
    // cannot be found without opting in. Without this, TalkBack would read
    // "clockwise open circle arrow, Waiting to send" — icon+label satisfying a
    // checklist while being worse for the person it exists for.
    const queued = item();
    await render(<QueueScreen items={[queued]} rejections={{}} />);

    // Verify 'Waiting to send' state glyph (↻)
    expect(screen.queryByText('\u21BB')).toBeNull();
    expect(screen.getByText('\u21BB', { includeHiddenElements: true })).toBeTruthy();

    // The label beside it is not hidden.
    expect(screen.getByText('Waiting to send')).toBeTruthy();
  });

  it('uses only documented Basic Unicode glyphs, not emoji', async () => {
    // Pinned to the exact set of five codepoints. Below U+2800 is not enough to
    // exclude emoji (Misc Symbols/Dingbats blocks overlap); an allowlist is
    // simpler and strictly stronger.
    const ALLOWED_GLYPHS = new Set(['\u2713', '\u21BB', '\u25F7', '\u2715', '\u2298']);

    await render(<QueueScreen items={[]} rejections={{}} />);

    // Find the glyph in the empty state (it is a sibling of 'Everything is sent')
    const label = screen.getByText('Everything is sent');
    const statusLine = label.parent;
    const glyph = statusLine?.children[0];
    // `children` is `ReactTestInstance | string`. Narrowing rather than casting to
    // `any` keeps the failure legible: if the tree ever changes shape, this throws
    // saying so, instead of reading `.props` off a string and asserting undefined.
    if (glyph === undefined || typeof glyph === 'string') {
      throw new Error('expected the glyph to be an element, not a bare text node');
    }
    const char = (glyph.props as { children?: unknown }).children;

    expect(typeof char).toBe('string');
    expect(ALLOWED_GLYPHS.has(char as string)).toBe(true);
  });
});

/**
 * S3 — the upload that keeps failing.
 *
 * The design calls this "the only critical colour in the whole flow", and the two
 * things it must do are scope the damage precisely and say out loud that the
 * failure is the system's, not the MR's.
 */
describe('S3 — when something will not go', () => {
  const stuck = () =>
    item({ id: '15151515-1515-4515-8515-151515151502', entity: 'recording', attemptCount: 5 });

  it('says how many things are stuck, not just that something failed', async () => {
    await render(<QueueScreen items={[stuck()]} rejections={{}} />);
    expect(screen.getByText('1 thing won’t go')).toBeTruthy();
  });

  it('names what did get through, so the MR knows their day exists', async () => {
    // The difference between a bad evening and a re-entered day. An MR who sees
    // only "upload failed" has no way to tell which half of their work survived.
    await render(
      <QueueScreen
        items={[stuck(), item({ id: '15151515-1515-4515-8515-151515151503', status: 'synced' })]}
        rejections={{}}
      />,
    );
    expect(screen.getByText(/Everything else went through/u)).toBeTruthy();
    expect(screen.getByText(/Stuck: recording/u)).toBeTruthy();
  });

  it('states that the failure is not counted against the MR', async () => {
    await render(<QueueScreen items={[stuck()]} rejections={{}} />);
    expect(
      screen.getByText('This is not counted against you. The upload failed, not you.'),
    ).toBeTruthy();
  });

  it('shows nothing of the sort while items are merely waiting', async () => {
    // Waiting is a normal state. Raising a critical block for it is how an app
    // teaches an MR that its warnings mean nothing.
    await render(<QueueScreen items={[item({ attemptCount: 0 })]} rejections={{}} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not fold a server refusal into "won’t go"', async () => {
    // A refusal is the server answering, and the row carries its sentence verbatim.
    // Counting it as a malfunction would turn a decision into a fault.
    await render(
      <QueueScreen items={[item({ attemptCount: 0 })]} rejections={{ [item().id]: rejection() }} />,
    );
    expect(screen.queryByText(/won’t go/u)).toBeNull();
  });

  it('offers no advice it cannot back and no button that does nothing', async () => {
    // S3 suggests "get on WiFi and tap Send". With no Send action wired, that is
    // advice the MR cannot follow, on the screen least able to afford it.
    await render(<QueueScreen items={[stuck()]} rejections={{}} />);
    expect(screen.queryByText('Try again now')).toBeNull();
    expect(screen.queryByText('Tell the help desk')).toBeNull();
  });

  it('offers both actions once there is somewhere for them to go', async () => {
    const onRetry = jest.fn();
    await render(
      <QueueScreen
        items={[stuck()]}
        onContactSupport={() => undefined}
        onRetry={onRetry}
        rejections={{}}
      />,
    );
    await fireEvent.press(screen.getByText('Try again now'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Tell the help desk')).toBeTruthy();
  });
});

/**
 * MR-17 B1 — the remedy reaches the screen, under the server's sentence.
 *
 * The two are different things and are kept apart deliberately: `explanation` is Backend's,
 * says what went wrong, and is rendered verbatim; `remedy` is the client's and says what to
 * do next. A screen that showed only the first tells an MR they are stuck without telling
 * them how to get unstuck.
 */
describe('what to do about a refusal, not only what it was', () => {
  it('renders the remedy beneath the server sentence', async () => {
    await render(
      <QueueScreen
        items={[item({ id: '15151515-1515-4515-8515-151515151577' })]}
        rejections={{
          '15151515-1515-4515-8515-151515151577': rejection({
            explanation: 'The consent notice changed since it was displayed.',
            remedy: 'Open consent again, read the current notice aloud, and ask once more.',
          }),
        }}
      />,
    );
    expect(screen.getByText('The consent notice changed since it was displayed.')).toBeTruthy();
    expect(
      screen.getByText('Open consent again, read the current notice aloud, and ask once more.'),
    ).toBeTruthy();
  });

  it('renders NOTHING extra when there is no honest remedy to give', async () => {
    // The other half, and the one that keeps the first honest. An unmapped SQLSTATE has no
    // remedy, and inventing one would send the MR to do the wrong thing.
    await render(
      <QueueScreen
        items={[item({ id: '15151515-1515-4515-8515-151515151577' })]}
        rejections={{
          '15151515-1515-4515-8515-151515151577': rejection({
            explanation: 'Something the app does not recognise.',
            remedy: null,
          }),
        }}
      />,
    );
    expect(screen.getByText('Something the app does not recognise.')).toBeTruthy();
    expect(screen.queryByText(/read the current notice/i)).toBeNull();
  });
});
