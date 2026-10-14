/**
 * The console's destinations, and which role each one is for — `FE-W164`.
 *
 * **Pure, and outside `nav.tsx`.** That file is `'use client'`, and a `'use client'` module's
 * exports are client references on the server (`sim-content-row.ts` records the 500 that taught this
 * repository the rule). The layout decides the role on the server and the sidebar draws it in the
 * browser, so the list both read lives here.
 *
 * **Showing an entry is a courtesy, not a permission.** Every page reads and writes as the signed-in
 * user, and the database's policies and functions decide what that user may do — whatever this list
 * says. What the list changes is only what a person is OFFERED: a manager used to see all seventeen
 * entries, and eight of them answered with a refusal. `roles` mirrors what each page's own reads
 * already refuse; it does not invent a rule.
 */
export type ConsoleRole = 'admin' | 'field_manager' | 'mr';

export interface NavItem {
  readonly label: string;
  readonly href: string;
  /** The roles this destination works for. The database still decides; see above. */
  readonly roles: readonly ConsoleRole[];
}

export interface NavGroup {
  readonly title: string;
  readonly items: readonly NavItem[];
}

const ADMIN: readonly ConsoleRole[] = ['admin'];
const MANAGER: readonly ConsoleRole[] = ['field_manager'];
const BOTH: readonly ConsoleRole[] = ['admin', 'field_manager'];

export const GROUPS: readonly NavGroup[] = [
  {
    title: 'Team',
    items: [
      { label: 'Coaching queue', href: '/coaching', roles: BOTH },
      // `BE-W171` / `BE-C78`. The manager plans a rep's day; `plannable_reps` refuses an admin.
      { label: 'Plan a rep’s day', href: '/planning', roles: MANAGER },
      // `FE-W72` / `BE-W180`. Reps' latest positions and today's list; the admin's company switch.
      { label: 'Live location', href: '/tracking', roles: BOTH },
      // `BE-W191`. Who started and ended their day, and reopening an ended one, with a reason.
      { label: 'The team’s day', href: '/days', roles: BOTH },
      // W2-G B (OP-6). `assign_course` admits an admin or a field manager, each for people they see.
      { label: 'Course assignments', href: '/learning', roles: BOTH },
    ],
  },
  {
    // Was "Content approvals". A manager reads Courses here and approves nothing, so the group is
    // named for what it holds rather than for the admin's half of it.
    title: 'Content',
    items: [
      // W1-A E3. RLS shows a non-admin approved versions only; this queue lists the other two.
      { label: 'Knowledge', href: '/knowledge', roles: ADMIN },
      // W1-F B. Writing and approving a practice doctor or scenario is an admin's.
      { label: 'Practice doctors', href: '/practice', roles: ADMIN },
      // The AI coach's analysis of practice sessions. Admins only (RLS); never a manager's.
      { label: 'Practice feedback', href: '/practice-feedback', roles: ADMIN },
      // W1-G E1 / BE-W122. `ai_prompt_versions_admin_select` admits admins only.
      { label: 'AI prompts', href: '/prompts', roles: ADMIN },
      // A manager reads what is published; only an admin publishes or retires.
      { label: 'Courses', href: '/courses', roles: BOTH },
    ],
  },
  {
    title: 'Governance',
    items: [
      { label: 'Consent versions', href: '/admin', roles: ADMIN },
      { label: 'Planning access', href: '/planning/access', roles: ADMIN },
      // `FE-W91` / `BE-W201`. `live_tracking_notices` refuses anybody but an admin.
      { label: 'Live location notice', href: '/tracking/notice', roles: ADMIN },
    ],
  },
  {
    // `FE-W75`–`FE-W78`. A manager reads their own territory subtree; the rest are an admin's.
    title: 'Administration',
    items: [
      { label: 'Users & roles', href: '/users', roles: ADMIN },
      { label: 'Territories', href: '/territories', roles: BOTH },
      { label: 'Audit log', href: '/audit', roles: ADMIN },
      { label: 'Retention & purge', href: '/retention', roles: ADMIN },
    ],
  },
];

/**
 * The groups to draw for `role`, empty groups left out.
 *
 * **An unknown role (`null`) is shown everything**, as before `FE-W164`: the role is one read, and if
 * it fails, hiding every destination would strand an admin over a hiccup — while showing too much
 * costs only a page that says it is not theirs. A rep is offered nothing: the console is the desk
 * half of the product, and a rep's work is in the app.
 */
export const navGroupsFor = (role: ConsoleRole | null): readonly NavGroup[] =>
  role === null
    ? GROUPS
    : GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.roles.includes(role)),
      })).filter((group) => group.items.length > 0);

/** The line beside the brand mark: who this console is being used as. */
export const roleName = (role: ConsoleRole | null): string =>
  role === 'admin'
    ? 'Admin'
    : role === 'field_manager'
      ? 'Manager'
      : role === 'mr'
        ? 'Rep'
        : 'Console';

/** The most specific destination that contains the current path — whoever is signed in. */
export const currentHref = (pathname: string): string | null => {
  const all = GROUPS.flatMap((group) => group.items.map((item) => item.href));
  const matches = all.filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
};

/** `user_profiles.role` as the console reads it: one of the three, or null for anything else. */
export const asConsoleRole = (value: unknown): ConsoleRole | null =>
  value === 'admin' || value === 'field_manager' || value === 'mr' ? value : null;
