import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
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

    expect(screen.queryByText('↻')).toBeNull();
    expect(screen.getByText('↻', { includeHiddenElements: true })).toBeTruthy();

    // The label beside it is not hidden.
    expect(screen.getByText('Waiting to send')).toBeTruthy();
  });

  it('uses Basic Unicode rather than emoji, which can render as tofu on OEM ROMs', async () => {
    // Emoji presentation varies across Android OEM font stacks — the Xiaomi/Oppo/Vivo
    // ROMs this product targets are exactly where that bites.
    await render(<QueueScreen items={[]} rejections={{}} />);
    const glyph = screen.getByText('✓', { includeHiddenElements: true });
    const codepoint = (glyph.props['children'] as string).codePointAt(0) ?? 0;
    expect(codepoint).toBeLessThan(0x2800);
  });
});
