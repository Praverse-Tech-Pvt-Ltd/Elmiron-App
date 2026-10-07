import type { ReactNode } from 'react';
import { tokens } from '@fieldforce/ui-tokens';
import { signedIn } from '../../lib/session';
import { Body, MissingNote, Title } from '../../lib/ui';
import { CourseAssignment } from '../../lib/course-assignment';
import type { AssignableCourse, AssignedRow, Person } from '../../lib/course-assignment';

/**
 * W2-G B (OP-6) — assigning a course, the step the rep's Learning screens have been waiting on:
 * `assign_course` existed and no screen called it.
 *
 * **Who may, from the function, not from this page.** `assign_course` is granted to every signed-in
 * user and admits an ADMIN or a FIELD MANAGER, each only for people they can already see
 * (`visible_user_ids()`: an admin their company, a manager their territory and reporting line). This
 * page does not decide any of it. RLS decides what it can read — courses of the company, the people
 * the caller may see, the assignments of those people — and the RPC decides the write; a refusal is
 * shown in words (`course-assignment-text.ts`).
 */
export const dynamic = 'force-dynamic';

export default async function Learning(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const [courses, versions, people, assignments] = await Promise.all([
    session.db.from('courses').select('id, title, is_active').order('title'),
    session.db.from('course_versions').select('course_id, status').eq('status', 'published'),
    session.db.from('user_profiles').select('id, full_name, role').order('full_name'),
    session.db
      .from('course_assignments')
      .select('id, course_id, assignee_user_id, due_on, assigned_at')
      .is('cancelled_at', null)
      .order('assigned_at', { ascending: false }),
  ]);

  const published = new Set((versions.data ?? []).map((v) => String(v.course_id)));
  const assignable: AssignableCourse[] = (courses.data ?? [])
    .filter((c) => c.is_active === true)
    .map((c) => ({
      id: String(c.id),
      title: String(c.title),
      published: published.has(String(c.id)),
    }));
  const team: Person[] = (people.data ?? [])
    .filter((p) => String(p.id) !== session.userId)
    .map((p) => ({ id: String(p.id), name: String(p.full_name), role: String(p.role) }));
  const titleOf = new Map(assignable.map((c) => [c.id, c.title]));
  const nameOf = new Map(team.map((p) => [p.id, p.name]));
  const rows: AssignedRow[] = (assignments.data ?? []).map((a) => ({
    id: String(a.id),
    course: titleOf.get(String(a.course_id)) ?? 'A course you cannot see',
    person: nameOf.get(String(a.assignee_user_id)) ?? 'Someone outside your team',
    dueOn: a.due_on === null ? null : String(a.due_on),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1000 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
        <Title>Course assignments</Title>
        <Body muted>
          Give someone in your team a course to take in the app. Only a course with a published
          version can be assigned. Admins and field managers can assign; each only to people they
          can see.
        </Body>
      </div>
      <CourseAssignment assigned={rows} courses={assignable} people={team} />
    </div>
  );
}
