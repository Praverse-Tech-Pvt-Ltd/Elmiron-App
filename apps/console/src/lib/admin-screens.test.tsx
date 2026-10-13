// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AdminUser, PendingUser, TerritoryNode } from '@fieldforce/core';

/**
 * `FE-W75` / `FE-W76` — the Users and Territories screens, rendered. The database refuses every
 * mistake whatever the screen does; these assert the screen does not OFFER the mistakes: no
 * territory for an admin, no Region for a rep, the admin role only with the email typed again, no
 * self-deactivation, and no edit control for a manager.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./supabase', () => ({ browserClient: vi.fn() }));

const { UsersAdmin } = await import('./users-admin');
const { TerritoriesAdmin } = await import('./territories-admin');

afterEach(cleanup);

const id = (n: number): string => `0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a${String(n).padStart(2, '0')}`;

const node = (
  over: Partial<TerritoryNode> & Pick<TerritoryNode, 'id' | 'code'>,
): TerritoryNode => ({
  parentId: null,
  name: `${over.code} name`,
  depth: 1,
  children: 0,
  activeUsers: 0,
  reps: 0,
  doctors: 0,
  ownHours: null,
  hours: null,
  ...over,
});

const TREE = [
  node({ id: id(1), code: 'IN', depth: 1, children: 1 }),
  node({ id: id(2), code: 'IN-W', parentId: id(1), depth: 2, children: 1 }),
  node({ id: id(3), code: 'IN-W-PUN', parentId: id(2), depth: 3, reps: 1 }),
];

const user = (
  over: Partial<AdminUser> & Pick<AdminUser, 'id' | 'fullName' | 'role'>,
): AdminUser => ({
  email: `${over.fullName.toLowerCase().replace(/ /gu, '.')}@example.test`,
  territoryId: null,
  territoryName: null,
  territoryCode: null,
  managerId: null,
  managerName: null,
  isActive: true,
  confirmed: true,
  lastSignInAt: null,
  createdAt: '2026-10-13T05:00:00+00:00',
  activeReports: 0,
  ...over,
});

const ME = user({ id: id(10), fullName: 'Asha Admin', role: 'admin' });
const MANAGER = user({
  id: id(11),
  fullName: 'Manoj Manager',
  role: 'field_manager',
  territoryId: id(2),
  territoryCode: 'IN-W',
});
const REP = user({
  id: id(12),
  fullName: 'Ravi Rep',
  role: 'mr',
  territoryId: id(3),
  territoryCode: 'IN-W-PUN',
  managerId: id(11),
  managerName: 'Manoj Manager',
});

describe('FE-W75 — Users & roles', () => {
  it('a rep’s territory picker offers only the bottom of a branch; an admin is offered none', () => {
    render(
      <UsersAdmin selfId={ME.id} users={[ME, MANAGER, REP]} pending={[]} territories={TREE} />,
    );
    const create = screen.getByText('Add a user').parentElement as HTMLElement;
    const territory = within(create).getByLabelText('Territory');
    const options = within(territory)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Choose a territory…', 'Area/Territory · IN-W-PUN — IN-W-PUN name']);

    fireEvent.change(within(create).getByLabelText('Role'), { target: { value: 'admin' } });
    expect(within(create).queryByLabelText('Territory')).toBeNull();
    expect(within(create).getByLabelText('Email again')).toBeTruthy();
  });

  it('the admin role cannot be submitted until the email is typed again', () => {
    render(<UsersAdmin selfId={ME.id} users={[ME]} pending={[]} territories={TREE} />);
    const create = screen.getByText('Add a user').parentElement as HTMLElement;
    fireEvent.change(within(create).getByLabelText('Email'), {
      target: { value: 'b@example.test' },
    });
    fireEvent.change(within(create).getByLabelText('Full name'), { target: { value: 'B' } });
    fireEvent.change(within(create).getByLabelText('Role'), { target: { value: 'admin' } });
    const button = within(create).getByRole<HTMLButtonElement>('button', { name: 'Create user' });
    expect(button.disabled).toBe(true);
    fireEvent.change(within(create).getByLabelText('Email again'), {
      target: { value: 'b@example.test' },
    });
    expect(button.disabled).toBe(false);
  });

  it('a rep cannot be submitted without a manager', () => {
    render(<UsersAdmin selfId={ME.id} users={[ME, MANAGER]} pending={[]} territories={TREE} />);
    const create = screen.getByText('Add a user').parentElement as HTMLElement;
    fireEvent.change(within(create).getByLabelText('Email'), {
      target: { value: 'r@example.test' },
    });
    fireEvent.change(within(create).getByLabelText('Full name'), { target: { value: 'R' } });
    fireEvent.change(within(create).getByLabelText('Territory'), { target: { value: id(3) } });
    const button = within(create).getByRole<HTMLButtonElement>('button', { name: 'Create user' });
    expect(button.disabled).toBe(true);
    fireEvent.change(within(create).getByLabelText('Reporting manager'), {
      target: { value: id(11) },
    });
    expect(button.disabled).toBe(false);
  });

  it('offers no control to change or deactivate oneself, and asks for a second admin', () => {
    render(<UsersAdmin selfId={ME.id} users={[ME, REP]} pending={[]} territories={TREE} />);
    const mine = screen.getByText('Asha Admin').closest('tr') as HTMLElement;
    expect(within(mine).queryByRole('button', { name: 'Deactivate' })).toBeNull();
    expect(within(mine).getByText('Another admin changes your role or access.')).toBeTruthy();
    const theirs = screen.getByText('Ravi Rep').closest('tr') as HTMLElement;
    expect(within(theirs).getByRole('button', { name: 'Deactivate' })).toBeTruthy();
    expect(screen.getByText(/needs? a second admin/u)).toBeTruthy();
  });

  it('lists a started creation with a Finish control once its account exists', () => {
    const pending: PendingUser = {
      id: id(20),
      email: 'half@example.test',
      fullName: 'Half Made',
      role: 'field_manager',
      territoryId: id(2),
      managerId: null,
      adoptExisting: false,
      requestedAt: '2026-10-13T05:00:00+00:00',
      requestedBy: 'Asha Admin',
      accountExists: true,
      accountConfirmed: true,
      accountHasProfile: false,
    };
    render(<UsersAdmin selfId={ME.id} users={[ME]} pending={[pending]} territories={TREE} />);
    expect(screen.getByText('Started, not finished')).toBeTruthy();
    const row = screen.getByText('Half Made').closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Finish' })).toBeTruthy();
    expect(within(row).getByText('Account exists, confirmed — no profile yet')).toBeTruthy();
  });

  it('warns on a rep with no manager and an account that cannot sign in', () => {
    render(
      <UsersAdmin
        selfId={ME.id}
        users={[ME, { ...REP, managerId: null, managerName: null, confirmed: false }]}
        pending={[]}
        territories={TREE}
      />,
    );
    expect(screen.getByText('No reporting manager: nobody sees this rep’s work.')).toBeTruthy();
    expect(screen.getByText('Cannot sign in: the account is not confirmed.')).toBeTruthy();
  });
});

describe('FE-W76 — Territories', () => {
  it('a manager sees the tree in order, with no edit controls', () => {
    render(
      <TerritoriesAdmin
        canEdit={false}
        nodes={[TREE[2] as TerritoryNode, TREE[0] as TerritoryNode, TREE[1] as TerritoryNode]}
      />,
    );
    const codes = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getByText(/^IN/u).textContent);
    expect(codes).toEqual(['IN', 'IN-W', 'IN-W-PUN']);
    expect(screen.queryByText('Change')).toBeNull();
    expect(screen.queryByText('Add a National territory')).toBeNull();
  });

  it('an admin may add beneath a Region but not beneath an Area or a territory with reps', () => {
    render(<TerritoriesAdmin canEdit nodes={TREE} />);
    const region = screen.getByText('IN-W').closest('tr') as HTMLElement;
    expect(within(region).getByRole('button', { name: 'Add beneath' })).toBeTruthy();
    const area = screen.getByText('IN-W-PUN').closest('tr') as HTMLElement;
    expect(within(area).queryByRole('button', { name: 'Add beneath' })).toBeNull();
    expect(within(area).getByRole('button', { name: 'Hours' })).toBeTruthy();
  });
});
