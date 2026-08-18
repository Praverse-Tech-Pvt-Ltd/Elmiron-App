import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { BodyText } from '@fieldforce/ui';

/**
 * The render harness itself, and its negative control.
 *
 * This file exists to answer one question: **does the harness fail when a render is
 * wrong?** A harness that reports green on a broken render is worse than no harness,
 * because every route test and every screen test in push #4 will be trusted on the
 * strength of this one passing.
 *
 * Nothing here tests the app. It renders one existing component from `@fieldforce/ui`
 * and asserts the machinery works. Route tests and the queue screen are push #4.
 *
 * Globals are imported explicitly rather than relied on ambiently, and that is the
 * boundary enforcing itself. `@types/jest` would declare `describe`/`it`/`expect`
 * globally, so they would type-resolve inside the `.test.ts` files vitest runs — the
 * runner split would be invisible at the type level. Importing from `'@jest/globals'`
 * here and from `'vitest'` there makes which runner owns a file legible in its first
 * three lines.
 *
 * **`render` is async in RTL v14 and must be awaited.** It returns a Promise, so a
 * synchronous call silently produces a thenable with no query methods, and `screen`
 * then throws "`render` function has not been called" — which reads as though render
 * was never invoked rather than as an un-awaited promise. See docs/gotchas.md.
 */
describe('render harness', () => {
  it('renders a component from @fieldforce/ui and finds its text', async () => {
    // Proves the whole chain: jest-expo transforms TSX, the workspace package is
    // transformed as SOURCE rather than skipped as node_modules, the test renderer
    // mounts a React Native tree, and the query API reads it back.
    await render(<BodyText>your day&apos;s work is safe</BodyText>);
    expect(screen.getByText("your day's work is safe")).toBeTruthy();
  });

  it('does not find text that was never rendered — the negative control', async () => {
    await render(<BodyText>your day&apos;s work is safe</BodyText>);

    // COMMITTED IN THE PASSING ORIENTATION.
    //
    // First written as the failing form:
    //
    //     expect(screen.getByText('text that is not rendered')).toBeTruthy();
    //
    // which fails with "Unable to find an element with text: text that is not
    // rendered" and prints the rendered tree. That run is the proof the harness can
    // fail; the output is recorded in PROJECT-OVERVIEW.md -> FE-H1.
    //
    // Inverting to queryByText/toBeNull keeps the same assertion — that the text is
    // absent — in a form that passes. Flip it back to watch the harness fail.
    expect(screen.queryByText('text that is not rendered')).toBeNull();
  });
});
