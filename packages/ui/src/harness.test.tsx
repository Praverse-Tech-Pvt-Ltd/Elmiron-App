import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { BodyText } from './Text';

/**
 * The harness self-check for this package.
 *
 * A jest config that has never executed proves nothing, and `--passWithNoTests`
 * would let a config matching zero files report green forever. This file is the
 * smallest thing that proves the runner works here: it renders a component and it
 * fails when an assertion is wrong.
 *
 * `render` is async in RTL v14 and must be awaited — without it you get a thenable
 * with no query methods and "`render` function has not been called" from `screen`.
 */
describe('packages/ui render harness', () => {
  it('renders a component from this package', async () => {
    await render(<BodyText>the queue is empty</BodyText>);
    expect(screen.getByText('the queue is empty')).toBeTruthy();
  });

  it('does not find text that was never rendered — the negative control', async () => {
    await render(<BodyText>the queue is empty</BodyText>);
    // Committed passing. Flip to `getByText(...)`.toBeTruthy() to watch it fail with
    // "Unable to find an element with text: ...".
    expect(screen.queryByText('text that is not rendered')).toBeNull();
  });
});
