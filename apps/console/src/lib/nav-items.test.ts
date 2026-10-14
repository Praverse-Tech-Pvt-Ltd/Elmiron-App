import { describe, expect, it } from 'vitest';
import { GROUPS, asConsoleRole, currentHref, navGroupsFor, roleName } from './nav-items';

const hrefs = (role: Parameters<typeof navGroupsFor>[0]): string[] =>
  navGroupsFor(role).flatMap((group) => group.items.map((item) => item.href));

describe('FE-W164 — each role is offered the destinations that work for it', () => {
  it('offers a manager the team’s work, courses to read and their own territories', () => {
    expect(hrefs('field_manager')).toEqual([
      '/coaching',
      '/planning',
      '/tracking',
      '/days',
      '/learning',
      '/courses',
      '/territories',
    ]);
  });

  it('never offers a manager a page whose read refuses a manager', () => {
    const offered = hrefs('field_manager');
    for (const refused of [
      '/audit',
      '/retention',
      '/tracking/notice',
      '/users',
      '/practice-feedback',
      '/planning/access',
      '/prompts',
    ]) {
      expect(offered).not.toContain(refused);
    }
  });

  it('offers an admin everything except planning a rep’s day, which refuses an admin', () => {
    const all = GROUPS.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs('admin')).toEqual(all.filter((href) => href !== '/planning'));
  });

  it('offers a rep nothing, and leaves out a group with nothing in it', () => {
    expect(navGroupsFor('mr')).toEqual([]);
    expect(navGroupsFor('field_manager').map((g) => g.title)).toEqual([
      'Team',
      'Content',
      'Administration',
    ]);
  });

  it('shows everything when the role could not be read, rather than stranding an admin', () => {
    expect(navGroupsFor(null)).toBe(GROUPS);
  });
});

describe('FE-W164 — the brand line and the current entry', () => {
  it('names the role beside the brand mark', () => {
    expect(roleName('admin')).toBe('Admin');
    expect(roleName('field_manager')).toBe('Manager');
    expect(roleName(null)).toBe('Console');
  });

  it('finds the most specific entry for a path, whatever the role', () => {
    expect(currentHref('/tracking/notice')).toBe('/tracking/notice');
    expect(currentHref('/tracking')).toBe('/tracking');
    expect(currentHref('/coaching/abc')).toBe('/coaching');
    expect(currentHref('/nowhere')).toBeNull();
  });

  it('reads only the three roles from a profile row', () => {
    expect(asConsoleRole('admin')).toBe('admin');
    expect(asConsoleRole('owner')).toBeNull();
    expect(asConsoleRole(undefined)).toBeNull();
  });
});
