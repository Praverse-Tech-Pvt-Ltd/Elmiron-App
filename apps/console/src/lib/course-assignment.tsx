'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { LMS_RPC } from '@fieldforce/core';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote } from './ui';
import { assignRefusal, courseOptionLabel } from './course-assignment-text';
import { btn } from './theme-css';
import { dayLabel } from './india-date';

/**
 * W2-G B — the client half of `/learning`: pick a course and a person, assign. The write is the
 * `assign_course` RPC and nothing else; what it refuses is said in words, never as a failed form.
 *
 * `FE-W171`: the person picker starts empty ("Choose a person…") with reps first, so nobody is
 * assigned a course because their name happened to sort to the top; the due date is a date picker,
 * which submits the same `YYYY-MM-DD` the free-text box asked people to type; the Due column reads
 * "20 Oct 2026".
 */
export interface AssignableCourse {
  readonly id: string;
  readonly title: string;
  readonly published: boolean;
}
export interface Person {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}
export interface AssignedRow {
  readonly id: string;
  readonly course: string;
  readonly person: string;
  readonly dueOn: string | null;
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

export const CourseAssignment = ({
  courses,
  people,
  assigned,
}: {
  readonly courses: readonly AssignableCourse[];
  readonly people: readonly Person[];
  readonly assigned: readonly AssignedRow[];
}): ReactNode => {
  const router = useRouter();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [personId, setPersonId] = useState('');
  const reps = people.filter((p) => p.role === 'mr');
  const others = people.filter((p) => p.role !== 'mr');
  const [dueOn, setDueOn] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const dueValid = dueOn === '' || /^\d{4}-\d{2}-\d{2}$/u.test(dueOn);
  const ready = courseId !== '' && personId !== '' && dueValid && state.kind !== 'busy';

  const assign = (): void => {
    setState({ kind: 'busy' });
    const person = people.find((p) => p.id === personId)?.name ?? 'They';
    void browserClient()
      .rpc(LMS_RPC.assignCourse, {
        p_course_id: courseId,
        p_assignee_user_id: personId,
        p_due_on: dueOn === '' ? null : dueOn,
      })
      .then(({ error }) => {
        if (error !== null) {
          setState({ kind: 'refused', message: assignRefusal(error) });
          return;
        }
        setState({
          kind: 'done',
          message: `Assigned. ${person} will see it under Learning in the app.`,
        });
        router.refresh();
      });
  };

  return (
    <>
      <Card>
        <Heading>Assign a course</Heading>
        {courses.length === 0 ? <MissingNote>Your company has no courses yet.</MissingNote> : null}
        {people.length === 0 ? (
          <MissingNote>There is nobody you can assign a course to.</MissingNote>
        ) : null}

        <Label>Course</Label>
        <select
          aria-label="Course"
          value={courseId}
          onChange={(e) => {
            setCourseId(e.target.value);
          }}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {courseOptionLabel(c.title, c.published)}
            </option>
          ))}
        </select>

        <Label>Person</Label>
        <select
          aria-label="Person"
          value={personId}
          onChange={(e) => {
            setPersonId(e.target.value);
          }}
        >
          <option value="">Choose a person…</option>
          {reps.length === 0 ? null : (
            <optgroup label="Reps">
              {reps.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {others.length === 0 ? null : (
            <optgroup label="Managers and admins">
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <Label>Due date (optional)</Label>
        <input
          aria-label="Due date"
          type="date"
          value={dueOn}
          onChange={(e) => {
            setDueOn(e.target.value.trim());
          }}
        />
        {dueValid ? null : <MissingNote>Choose a date, or leave it empty.</MissingNote>}

        {state.kind === 'done' ? <Body>{state.message}</Body> : null}
        {state.kind === 'refused' ? (
          <MissingNote tone="critical">{state.message}</MissingNote>
        ) : null}

        <button type="button" className={btn('primary')} disabled={!ready} onClick={assign}>
          {state.kind === 'busy' ? 'Assigning…' : 'Assign'}
        </button>
      </Card>

      <Card>
        <Heading>Assigned</Heading>
        {assigned.length === 0 ? (
          <Body muted>Nothing assigned to anyone you can see.</Body>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Person</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {assigned.map((row) => (
                <tr key={row.id}>
                  <td>{row.course}</td>
                  <td>{row.person}</td>
                  <td className="ff-nowrap">{row.dueOn === null ? '—' : dayLabel(row.dueOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
};
