import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { TabIcon } from './TabIcon';
import type { TabIconName } from './TabIcon';

const NAMES: readonly TabIconName[] = ['today', 'doctors', 'coaching', 'me'];

describe('the tab icons', () => {
  it.each(NAMES)('%s renders shapes, never a character', async (name) => {
    // The whole reason this is drawn rather than pulled from an icon font: a font
    // missing a codepoint renders tofu, and this is the one control on every
    // screen. A `View` cannot tofu. If any text ever appears in this tree,
    // something has reintroduced a glyph.
    await render(<TabIcon focused={false} name={name} />);
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).not.toContain('"type":"Text"');
    expect(tree).not.toContain('fontFamily');
  });

  it.each(NAMES)('%s changes colour on focus and nothing else', async (name) => {
    // Focus is a colour change. If it also changed a size, the bar would reflow
    // under the MR's thumb every time they switched tab.
    await render(<TabIcon focused={false} name={name} />);
    const resting = JSON.stringify(screen.toJSON());

    await render(<TabIcon focused name={name} />);
    const active = JSON.stringify(screen.toJSON());

    expect(active).toContain(tokens.color.accent);
    expect(resting).not.toContain(tokens.color.accent);
    expect(resting).toContain(tokens.color.textSecondary);

    // Same geometry either way — swap the two colours and the trees match.
    expect(active.split(tokens.color.accent).join('X')).toBe(
      resting.split(tokens.color.textSecondary).join('X'),
    );
  });

  it('draws each tab differently, so the four are not one shape recoloured', async () => {
    const shapes = new Set<string>();
    for (const name of NAMES) {
      await render(<TabIcon focused={false} name={name} />);
      shapes.add(JSON.stringify(screen.toJSON()));
    }
    expect(shapes.size).toBe(NAMES.length);
  });
});
