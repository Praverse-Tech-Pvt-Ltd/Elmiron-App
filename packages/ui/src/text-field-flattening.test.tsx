import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { TextField } from './TextField';

/** A rendered host node, as the test library hands it back. */
type HostNode = NonNullable<ReturnType<typeof screen.getByLabelText>['parent']>;

/**
 * **FE-D9. The sign-out → sign-in crash.**
 *
 * On the Pixel 10, signing out and signing back in without closing the app killed it:
 *
 *   IllegalStateException: addViewAt: failed to insert view [502] into parent [532] at index 5
 *   Caused by: The specified child already has a parent. You must call removeView() first.
 *
 * View 502 was the Email `TextInput`; its parent 504 was the field's bordered wrapper. When the
 * sign-in succeeds, the screen starts leaving the stack and react-native-screens puts every view
 * in it into an Android "view transition" (`Screen.startTransitionRecursive`), which keeps a
 * removed child attached to its old parent until the transition ends. In the same frame the form
 * came back from busy to editable, and the wrapper's `opacity` went from 0.7 to 1.
 *
 * `opacity != 1` is one of the things that make a Fabric view form a **stacking context**
 * (`ViewShadowNode::initialize` in react-native). When that flips, Fabric's differ reparents the
 * view's children ("flattening"/"unflattening", `Differentiator.cpp`): remove 502 from 504,
 * insert it elsewhere. The remove did not take -- the transition held it -- so the insert threw.
 *
 * A jest renderer has no Fabric and no native views, so the crash itself cannot happen here. What
 * can be pinned is its precondition: **the field's wrapper must form the same kind of native view
 * whether or not the field is editable.** If it does, disabling or re-enabling a field is a prop
 * update and never a reparent, on any screen, leaving or not.
 */

const flatten = (style: unknown): Record<string, unknown> =>
  StyleSheet.flatten(style) as Record<string, unknown>;

/**
 * The part of react-native's own rule that props on a plain `View` can reach, from
 * `ReactCommon/react/renderer/components/view/ViewShadowNode.cpp` (`formsStackingContext`).
 */
const formsStackingContext = (node: HostNode): boolean => {
  const props = node.props as Record<string, unknown>;
  const style = flatten(props['style']);
  const opacity = style['opacity'];
  const transform = style['transform'];
  return (
    props['collapsable'] === false ||
    props['pointerEvents'] === 'box-only' ||
    props['pointerEvents'] === 'none' ||
    props['nativeID'] !== undefined ||
    props['accessible'] === true ||
    (opacity !== undefined && opacity !== 1) ||
    (Array.isArray(transform) && transform.length > 0) ||
    (style['zIndex'] !== undefined &&
      style['position'] !== undefined &&
      style['position'] !== 'static') ||
    style['display'] === 'none' ||
    style['overflow'] === 'hidden' ||
    props['removeClippedSubviews'] === true
  );
};

/** The nearest host `View` above the input: the bordered field wrapper. */
const wrapperOf = (label: string): HostNode => {
  let node = screen.getByLabelText(label).parent;
  while (node !== null && node.type !== 'View') node = node.parent;
  if (node === null) throw new Error(`no host View above "${label}"`);
  return node;
};

const noop = (): void => undefined;

describe('TextField — disabling a field never changes what kind of native view it is (FE-D9)', () => {
  it('forms a stacking context both when editable and when not', async () => {
    const field = (editable: boolean) => (
      <TextField editable={editable} label="Email" onChangeText={noop} value="mr@example.test" />
    );

    await render(field(true));
    const whileEditable = formsStackingContext(wrapperOf('Email'));

    await screen.rerender(field(false));
    const whileBusy = formsStackingContext(wrapperOf('Email'));

    expect({ whileEditable, whileBusy }).toEqual({ whileEditable: true, whileBusy: true });
  });

  it('still fades when disabled -- the look is unchanged, only the flattening is pinned', async () => {
    await render(<TextField editable={false} label="Email" onChangeText={noop} value="" />);
    expect(flatten(wrapperOf('Email').props['style'])['opacity']).toBe(0.7);
  });
});
