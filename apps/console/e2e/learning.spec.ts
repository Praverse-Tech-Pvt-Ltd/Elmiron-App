import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * W2-G B4 (OP-6) — assigning a course, in a real browser, as the roles `assign_course` admits (an
 * admin, a field manager) and as one it does not (an MR). Every write is read back from the server
 * under the reader's own token, so "Assigned" on the screen is checked against what was stored.
 */
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const API = 'http://127.0.0.1:54321';

interface Person {
  readonly email: string;
  readonly userId: string;
  readonly organisationId: string;
}
interface Course {
  readonly id: string;
  readonly title: string;
}
interface World {
  readonly password: string;
  readonly run: string;
  readonly authorAdmin: Person;
  readonly manager: Person;
  readonly rep: Person;
  readonly publishedCourse: Course;
  readonly draftCourse: Course;
}

let world: World;

test.beforeAll(() => {
  world = JSON.parse(
    execFileSync('node', ['../../services/api/scripts/seed-practice-world.mjs'], {
      encoding: 'utf8',
    }),
  ) as World;
});

const signIn = async (page: Page, person: Person): Promise<void> => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password').fill(world.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/coaching/);
};

const tokenFor = async (person: Person): Promise<string> => {
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: person.email, password: world.password }),
  });
  return ((await auth.json()) as { access_token: string }).access_token;
};

/** The live assignments of one course, as the given person may read them (RLS decides). */
const assignmentsOf = async (reader: Person, courseId: string) => {
  const res = await fetch(
    `${API}/rest/v1/course_assignments?select=assignee_user_id,assigned_by_user_id,due_on&course_id=eq.${courseId}&cancelled_at=is.null`,
    { headers: { apikey: ANON, authorization: `Bearer ${await tokenFor(reader)}` } },
  );
  return (await res.json()) as {
    assignee_user_id: string;
    assigned_by_user_id: string;
    due_on: string | null;
  }[];
};

const assign = async (page: Page, course: string, person: string, due = ''): Promise<void> => {
  await page.goto('/learning');
  await page.getByLabel('Course').selectOption({ label: course });
  await page.getByLabel('Person').selectOption({ label: person });
  await page.getByLabel('Due date').fill(due);
  await page.getByRole('button', { name: 'Assign' }).click();
};

test('an ADMIN assigns a published course — stored as theirs, with the due date', async ({
  page,
}) => {
  await signIn(page, world.authorAdmin);
  await assign(page, world.publishedCourse.title, `manager ${world.run}`, '2026-10-20');
  await expect(
    page.getByText(`Assigned. manager ${world.run} will see it under Learning in the app.`),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: `manager ${world.run}` })).toBeVisible();

  const stored = await assignmentsOf(world.authorAdmin, world.publishedCourse.id);
  expect(stored).toContainEqual({
    assignee_user_id: world.manager.userId,
    assigned_by_user_id: world.authorAdmin.userId,
    due_on: '2026-10-20',
  });
});

test('a course with NO published version: the picker says so, and the refusal is said, not failed', async ({
  page,
}) => {
  await signIn(page, world.authorAdmin);
  const label = `${world.draftCourse.title} — no published version, cannot be assigned yet`;
  await assign(page, label, `rep ${world.run}`);
  await expect(
    page.getByText(
      'This course has no published version yet, so there is nothing to take. Publish a version first, then assign it.',
    ),
  ).toBeVisible();
  await expect(page.getByText(/^Assigned\./u)).toHaveCount(0);
  expect(await assignmentsOf(world.authorAdmin, world.draftCourse.id)).toEqual([]);
});

test('a FIELD MANAGER assigns to their own rep — the schema admits them, and it is stored as theirs', async ({
  page,
}) => {
  await signIn(page, world.manager);
  await assign(page, world.publishedCourse.title, `rep ${world.run}`);
  await expect(
    page.getByText(`Assigned. rep ${world.run} will see it under Learning in the app.`),
  ).toBeVisible();

  // Read back as the REP: their own assignment, made by the manager.
  const stored = await assignmentsOf(world.rep, world.publishedCourse.id);
  expect(stored).toEqual([
    { assignee_user_id: world.rep.userId, assigned_by_user_id: world.manager.userId, due_on: null },
  ]);
});

test('an MR may not: the screen offers nobody, and the server refuses the call itself', async ({
  page,
}) => {
  await signIn(page, world.rep);
  await page.goto('/learning');
  await expect(page.getByText('There is nobody you can assign a course to.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assign' })).toBeDisabled();

  // Not only the screen: the rep's own token, calling the RPC directly, is refused.
  const res = await fetch(`${API}/rest/v1/rpc/assign_course`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      authorization: `Bearer ${await tokenFor(world.rep)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_course_id: world.publishedCourse.id,
      p_assignee_user_id: world.rep.userId,
    }),
  });
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ code: '42501' });
});
