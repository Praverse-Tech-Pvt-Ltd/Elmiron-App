import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * LMS core — AI-B2, `20260924000500_lms_core.sql`.
 *
 * **A published version never changes.** A course is only a name; its content lives in versions.
 * A version is `draft` (admin-editable), then `published` (frozen, with its modules and lessons),
 * then `retired` (still frozen, closed to new learners). An enrolment pins a version, so what a
 * learner completed is always the exact text they read.
 *
 * **Reads** are PostgREST table reads (snake_case on the wire; the entity shapes below are the
 * camelCase a client maps them to). **Writes of state** go through the RPCs in `LMS_RPC`, whose
 * responses are already camelCase and are parsed against the response schemas below by
 * `services/api/tests/lms-core.spec.ts`.
 *
 * **Refusals** use the existing SQLSTATEs, no new ones: `28000` not signed in, `42501` not yours /
 * not permitted, `22023` wrong state (already published, not published, no lessons, retired to
 * new learners). A client's honest response to a `22023` here is to refresh and show the current
 * state.
 *
 * **Deliberately absent: any score, grade, mark or pass/fail.** Managers read enrolments, and
 * `.ai-collab/constraints.md` forbids a score on the manager surface. Whether training
 * assessments are exempt is decision X2 (`docs/ai-platform/phase-a-recon.md`); until it is made,
 * `contract.test.ts` holds these schemas to it.
 */

export const COURSE_VERSION_STATUSES = ['draft', 'published', 'retired'] as const;
export const CourseVersionStatusSchema = z.enum(COURSE_VERSION_STATUSES);
export type CourseVersionStatus = z.infer<typeof CourseVersionStatusSchema>;

// ---------------------------------------------------------------------------
// Entities (table reads)
// ---------------------------------------------------------------------------

export const CourseSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  title: z.string().min(1),
  isActive: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Course = z.infer<typeof CourseSchema>;

export const CourseVersionSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  courseId: UuidSchema,
  /** Assigned by the server: 1, 2, 3 … per course. */
  versionNumber: z.number().int().positive(),
  status: CourseVersionStatusSchema,
  title: z.string().min(1),
  summary: z.string().nullable(),
  productId: UuidSchema.nullable(),
  /** Null = not specific to a market. */
  marketId: UuidSchema.nullable(),
  publishedAt: IsoDateTimeSchema.nullable(),
  publishedByUserId: UuidSchema.nullable(),
  retiredAt: IsoDateTimeSchema.nullable(),
  retiredByUserId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CourseVersion = z.infer<typeof CourseVersionSchema>;

export const CourseModuleSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  courseVersionId: UuidSchema,
  position: z.number().int().positive(),
  title: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CourseModule = z.infer<typeof CourseModuleSchema>;

export const LessonSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  moduleId: UuidSchema,
  courseVersionId: UuidSchema,
  position: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().min(1),
  estimatedMinutes: z.number().int().positive().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Lesson = z.infer<typeof LessonSchema>;

export const CourseAssignmentSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  courseId: UuidSchema,
  assigneeUserId: UuidSchema,
  assignedByUserId: UuidSchema,
  /**
   * A date, not an instant. "Overdue" is NOT a field: it is a computation against the server's
   * clock at read time, and cannot ride `sync_pull` (`constraints.md`).
   */
  dueOn: IsoDateSchema.nullable(),
  assignedAt: IsoDateTimeSchema,
  cancelledAt: IsoDateTimeSchema.nullable(),
  cancelledByUserId: UuidSchema.nullable(),
});
export type CourseAssignment = z.infer<typeof CourseAssignmentSchema>;

export const CourseEnrolmentSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  userId: UuidSchema,
  courseVersionId: UuidSchema,
  startedAt: IsoDateTimeSchema,
  /** Stamped once by the server when the last lesson is completed. Never moves. */
  completedAt: IsoDateTimeSchema.nullable(),
});
export type CourseEnrolment = z.infer<typeof CourseEnrolmentSchema>;

export const LessonCompletionSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  enrolmentId: UuidSchema,
  userId: UuidSchema,
  lessonId: UuidSchema,
  completedAt: IsoDateTimeSchema,
});
export type LessonCompletion = z.infer<typeof LessonCompletionSchema>;

// ---------------------------------------------------------------------------
// RPCs (state changes)
// ---------------------------------------------------------------------------

/** PostgREST RPC names, `POST /rest/v1/rpc/<name>`, and who may call each. */
export const LMS_RPC = {
  /** Admin. Draft -> published; retires the previous published version for the same market. */
  publishCourseVersion: 'publish_course_version',
  /** Admin. Published -> retired. */
  retireCourseVersion: 'retire_course_version',
  /** Admin or field manager, for a user they can already see. Idempotent. */
  assignCourse: 'assign_course',
  /** Admin or field manager, within the same scope. Once. */
  cancelCourseAssignment: 'cancel_course_assignment',
  /** Anyone, for themselves. Idempotent: starting twice resumes. */
  startCourseVersion: 'start_course_version',
  /** Anyone, for their own enrolment. Idempotent. */
  completeLesson: 'complete_lesson',
} as const;

export const PublishCourseVersionRequestSchema = z.object({ p_course_version_id: UuidSchema });
export const PublishCourseVersionResponseSchema = z.object({
  courseVersionId: UuidSchema,
  status: z.literal('published'),
  publishedAt: IsoDateTimeSchema,
  retiredCourseVersionIds: z.array(UuidSchema),
});
export type PublishCourseVersionResponse = z.infer<typeof PublishCourseVersionResponseSchema>;

export const RetireCourseVersionRequestSchema = z.object({ p_course_version_id: UuidSchema });
export const RetireCourseVersionResponseSchema = z.object({
  courseVersionId: UuidSchema,
  status: z.literal('retired'),
  retiredAt: IsoDateTimeSchema,
});
export type RetireCourseVersionResponse = z.infer<typeof RetireCourseVersionResponseSchema>;

export const AssignCourseRequestSchema = z.object({
  p_course_id: UuidSchema,
  p_assignee_user_id: UuidSchema,
  p_due_on: IsoDateSchema.nullish(),
});
export const AssignCourseResponseSchema = z.object({
  id: UuidSchema,
  courseId: UuidSchema,
  assigneeUserId: UuidSchema,
  assignedByUserId: UuidSchema,
  dueOn: IsoDateSchema.nullable(),
  assignedAt: IsoDateTimeSchema,
});
export type AssignCourseResponse = z.infer<typeof AssignCourseResponseSchema>;

export const CancelCourseAssignmentRequestSchema = z.object({ p_assignment_id: UuidSchema });
export const CancelCourseAssignmentResponseSchema = z.object({
  id: UuidSchema,
  cancelledAt: IsoDateTimeSchema,
});
export type CancelCourseAssignmentResponse = z.infer<typeof CancelCourseAssignmentResponseSchema>;

export const StartCourseVersionRequestSchema = z.object({ p_course_version_id: UuidSchema });
export const StartCourseVersionResponseSchema = z.object({
  id: UuidSchema,
  courseVersionId: UuidSchema,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
});
export type StartCourseVersionResponse = z.infer<typeof StartCourseVersionResponseSchema>;

export const CompleteLessonRequestSchema = z.object({
  p_enrolment_id: UuidSchema,
  p_lesson_id: UuidSchema,
});
export const CompleteLessonResponseSchema = z.object({
  enrolmentId: UuidSchema,
  lessonId: UuidSchema,
  lessonCompletedAt: IsoDateTimeSchema,
  lessonsCompleted: z.number().int().nonnegative(),
  lessonsTotal: z.number().int().positive(),
  courseCompletedAt: IsoDateTimeSchema.nullable(),
});
export type CompleteLessonResponse = z.infer<typeof CompleteLessonResponseSchema>;
