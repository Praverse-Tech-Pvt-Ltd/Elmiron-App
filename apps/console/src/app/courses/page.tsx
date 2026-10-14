import type { ReactNode } from 'react';
import { signedIn } from '../../lib/session';
import { Body, MissingNote, Page, PageHeader, RoleNote } from '../../lib/ui';
import { callerRole } from '../../lib/role';
import { CoursePublishing } from '../../lib/course-publishing';
import type { CourseVersionRow } from '../../lib/course-publishing';
import type { CourseVersionStatus, VideoLesson } from '../../lib/course-publishing-text';

/**
 * LMS admin flow — publish and retire course versions. Until this page a loaded course moved on
 * only through `content-step.mjs publish-course` (`BE-W168`). Reads are RLS (an admin reads their
 * company's courses); the writes are `publish_course_version` and `retire_course_version`.
 *
 * Courses publish in ONE step by design: whether a course needs a second admin's approval is the
 * operator's open question Q-21, and it is not decided here.
 *
 * `FE-W164`: a manager reads the list and is told once that publishing is an admin's, with no
 * Publish or Retire button to press into a refusal. `FE-W165`: the description no longer names a
 * file in the repository.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Courses' };

const STATUSES: readonly CourseVersionStatus[] = ['draft', 'published', 'retired'];
const asStatus = (value: unknown): CourseVersionStatus =>
  STATUSES.find((s) => s === value) ?? 'retired';

export default async function Courses(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const [role, courses, versions, lessons] = await Promise.all([
    callerRole(),
    session.db.from('courses').select('id, title'),
    session.db
      .from('course_versions')
      .select('id, course_id, version_number, title, status')
      .order('created_at', { ascending: false }),
    session.db
      .from('lessons')
      .select('id, course_version_id, title, position, video_object_path, video_duration_seconds')
      .order('position', { ascending: true }),
  ]);

  const titleOf = new Map((courses.data ?? []).map((c) => [String(c.id), String(c.title)]));
  const lessonCount = new Map<string, number>();
  // `FE-W128` — the lessons that carry a video (`BE-W208`), per version, with the loader's measured length.
  const videosOf = new Map<string, VideoLesson[]>();
  for (const lesson of lessons.data ?? []) {
    const version = String(lesson.course_version_id);
    lessonCount.set(version, (lessonCount.get(version) ?? 0) + 1);
    if (typeof lesson.video_object_path === 'string') {
      const seconds: unknown = lesson.video_duration_seconds;
      videosOf.set(version, [
        ...(videosOf.get(version) ?? []),
        { lesson: String(lesson.title), seconds: typeof seconds === 'number' ? seconds : null },
      ]);
    }
  }
  const rows: CourseVersionRow[] = (versions.data ?? []).map((v) => ({
    id: String(v.id),
    course: titleOf.get(String(v.course_id)) ?? 'A course you cannot see',
    version: Number(v.version_number),
    title: String(v.title),
    status: asStatus(v.status),
    lessons: lessonCount.get(String(v.id)) ?? 0,
    videos: videosOf.get(String(v.id)) ?? [],
  }));

  // An unknown role is offered the buttons, as before; the function decides.
  const canChange = role === null || role === 'admin';

  return (
    <Page>
      <PageHeader title="Courses">
        <Body muted>
          Publish a loaded course version so it can be assigned and taken in the app; retire one
          that should no longer be started. Publishing a new version retires the previous one for
          the same market. A lesson’s video is loaded with its course and is frozen with the
          version, like its text.
        </Body>
      </PageHeader>
      {canChange ? null : (
        <RoleNote>
          Only an admin publishes or retires a course. You can see every version and where it
          stands.
        </RoleNote>
      )}
      <CoursePublishing canChange={canChange} rows={rows} />
    </Page>
  );
}
