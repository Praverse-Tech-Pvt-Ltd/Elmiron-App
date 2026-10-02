-- Rollback for W1-K -- `lms_tutor_lesson_context()` is dropped. No table, no data.
--
-- **What rolling back MEANS.** `answerLessonQuestion` calls this before anything else, so without it
-- every `lms_tutor` request fails with the generic failure message. **That is the safe direction, and
-- it is why the call sits where it does:** the lesson context is fetched BEFORE the model, so a
-- missing function cannot degrade into a tutor answering from nothing. A tutor with no lesson in
-- front of it is exactly the thing this feature was designed not to be.
--
-- **Roll back `packages/core` and `supabase/functions/` with this**, or `lms_tutor` returns a failure
-- on every question and no message explains why. `product_qa`, `mr_chat`, `ai_doctor` and `ai_coach`
-- are unaffected — none of them calls it.
--
-- **Nothing about the LMS changes.** `lessons`, `course_versions` and `course_enrolments` are not
-- touched here; this only removes the scoped read.

drop function if exists public.lms_tutor_lesson_context(uuid);
