import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BrandLine } from './BrandLine';

/**
 * §03 allows Cormorant exactly one appearance in the product: "login splash only.
 * Not a screen title, not a section header, not an empty state."
 *
 * That is a rule about the whole package, not about one component, so one of these
 * tests reads the source of every sibling. A rule enforced only by a comment is a
 * rule that survives until the first person in a hurry.
 */
describe('the one Cormorant moment', () => {
  it('renders the caller’s words at §03’s size and weight', async () => {
    await render(<BrandLine>Relief at the root.</BrandLine>);
    expect(screen.getByText('Relief at the root.')).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).toContain(tokens.font.brand);
    expect(tree).toContain(String(tokens.typography.brand.size));
  });

  it('is not a heading, so it does not become the first landmark on sign-in', async () => {
    // A brand line announced ahead of "Sign in" puts the branding in front of the
    // thing the MR opened the app to do.
    await render(<BrandLine>Relief at the root.</BrandLine>);
    expect(screen.queryByRole('header')).toBeNull();
  });

  it('is the only file in the package that names the Cormorant family', () => {
    const dir = __dirname;
    const offenders = readdirSync(dir)
      .filter((name) => /\.tsx?$/u.test(name))
      .filter((name) => name !== 'BrandLine.tsx' && !name.includes('brand-line.test'))
      .filter((name) => readFileSync(join(dir, name), 'utf8').includes('font.brand'));

    expect(offenders).toEqual([]);
  });

  it('cannot be reached through the weight map', () => {
    // `fontFamilyFor` is how every other component gets a family. Cormorant is not
    // a weight in that map, so a stylesheet cannot ask for it by accident.
    expect(Object.values(tokens.font)).toContain(tokens.font.brand);
    expect(['400', '500', '600', '700']).not.toContain('brand');
  });
});
