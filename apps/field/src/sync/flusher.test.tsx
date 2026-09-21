import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { BodyText } from '@fieldforce/ui';

/**
 * MR-49 / `FE-W61`. The Me screen tells an MR signing out that their unsent work "sends the next
 * time you sign in here". On the Pixel 10 the flusher ran only on mount and on foreground, so after
 * a sign-in without an app restart nothing was sent. It now also runs when the signed-in user
 * changes -- and never with no one signed in, because there is no queue then.
 */
const mockFlush = jest.fn<() => Promise<unknown>>();
const mockUser = jest.fn<() => string | null>();

jest.mock('./outbox', () => ({ flushOutbox: () => mockFlush() }));
jest.mock('./push-client', () => ({ createPushClient: () => ({}) }));
jest.mock('../session', () => ({
  useSession: () => {
    const id = mockUser();
    return { session: id === null ? null : { user: { id } } };
  },
}));

import { OutboxFlusher } from './flusher';

const tree = (): React.JSX.Element => (
  <OutboxFlusher>
    <BodyText>child</BodyText>
  </OutboxFlusher>
);

beforeEach(() => {
  mockFlush.mockReset();
  mockFlush.mockResolvedValue(undefined);
});

describe('OutboxFlusher — FE-W61, the queue is sent when its owner signs in', () => {
  it('flushes when a user signs in, and again when a DIFFERENT user signs in', async () => {
    mockUser.mockReturnValue('rep-a');
    const view = await render(tree());
    expect(mockFlush).toHaveBeenCalledTimes(1);

    mockUser.mockReturnValue('rep-b');
    await view.rerender(tree());
    expect(mockFlush).toHaveBeenCalledTimes(2);
  });

  it('does not flush again on a re-render for the SAME user', async () => {
    mockUser.mockReturnValue('rep-a');
    const view = await render(tree());
    await view.rerender(tree());
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE CONTROL: never flushes with no one signed in', async () => {
    mockUser.mockReturnValue(null);
    await render(tree());
    expect(mockFlush).not.toHaveBeenCalled();
  });
});
