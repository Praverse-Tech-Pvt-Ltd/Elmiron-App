-- ---------------------------------------------------------------------------
-- W1-K Part B — `lms_tutor_lesson_context()`: the one lesson a tutor may explain.
--
-- ## What this decides, and it is the whole design of the feature
--
-- `AI-SPEC` §3: the learning tutor *"explains a lesson the learner did not
-- follow"*. So unlike `mr_chat`, which is a general assistant with no sources,
-- **the tutor has approved text in front of it** — the lesson's own `body`,
-- written by the company and published through `course_versions`.
--
-- **That makes the tutor the strongest of the four features, not the weakest**,
-- and this function is why: it returns exactly one lesson, and the flow gives
-- the model nothing else. `product_qa` has the same shape — answer only from
-- what you are given — and it is the shape that actually prevents invention,
-- as opposed to asking a model not to invent.
--
-- ## Every restriction here is deliberate
--
-- * **One lesson, not a course.** A tutor explaining lesson 3 does not need
--   lesson 7, and anything it is given it can quote. The learner names the
--   lesson; the database decides whether they may see it.
-- * **The learner must be ENROLLED on that course version.** Not "in the same
--   organisation" — enrolled. A rep cannot ask the tutor to read out a course
--   they were never assigned, which would make the tutor a way to read the
--   whole catalogue.
-- * **The course version must be PUBLISHED.** A draft lesson is unapproved
--   text; explaining it would be the never-born-approved rule (`C24`) defeated
--   through a side door.
-- * **Title and body only.** No ids of neighbours, no module tree, no
--   completion state. The caller needs text to explain and nothing more, and
--   every extra column is data leaving the database for a purpose nobody asked
--   for — the same reason `ai_requests` stores no question and no answer.
--
-- ## Tenancy
--
-- `security definer` with `search_path = ''`, resolving the caller from
-- `lms_caller()` rather than from an argument, so there is no parameter through
-- which one tenant could reach another's courses. The enrolment check makes the
-- organisation check redundant and it is kept anyway: two independent reasons a
-- row is refused is the posture every other function here takes.
-- ---------------------------------------------------------------------------

create or replace function public.lms_tutor_lesson_context(p_lesson_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_row    record;
begin
  select * into v_caller from public.lms_caller();

  if p_lesson_id is null then
    raise exception 'a lesson is required' using errcode = '22023';
  end if;

  select l.id, l.title, l.body, l.course_version_id, c.title as course_title
    into v_row
    from public.lessons l
    join public.course_versions cv on cv.id = l.course_version_id
    join public.courses c          on c.id  = cv.course_id
   where l.id = p_lesson_id
     and l.organisation_id = v_caller.organisation_id
     -- PUBLISHED only: a draft lesson is unapproved text.
     and cv.status = 'published'
     -- ENROLLED only: the tutor is not a way to read the catalogue.
     and exists (
       select 1 from public.course_enrolments e
        where e.course_version_id = l.course_version_id
          and e.user_id = v_caller.user_id);

  if not found then
    -- One message for "does not exist", "not published" and "not enrolled".
    -- Distinguishing them would tell a caller which courses exist.
    raise exception 'lesson % is not available to you', p_lesson_id using errcode = '42501';
  end if;

  return jsonb_build_object(
    'lessonId', v_row.id,
    'lessonTitle', v_row.title,
    'lessonBody', v_row.body,
    'courseTitle', v_row.course_title);
end;
$$;

comment on function public.lms_tutor_lesson_context(uuid) is
  'W1-K: the title and body of ONE published lesson the caller is enrolled on, for lms_tutor. '
  'Text only -- the tutor explains what it is given, and anything more would be data leaving the '
  'database for no stated purpose.';

revoke all on function public.lms_tutor_lesson_context(uuid) from public, anon, authenticated;
grant execute on function public.lms_tutor_lesson_context(uuid) to authenticated;
