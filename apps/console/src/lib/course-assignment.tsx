'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { LMS_RPC } from '@fieldforce/core';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote, cell, headerCell } from './ui';
import { assignRefusal, courseOptionLabel } from './course-assignment-text';

/**
 * W2-G B — the client half of `/learning`: pick a course and a person, assign. The write is the
 * `assign_course` RPC and nothing else; what it refuses is said in words, never as a failed form.
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

const field = (): CSSProperties => ({
  width: '100%',
  padding: tokens.space.sm,
  border: `1px solid ${tokens.color.textPrimary}`,
  borderRadius: tokens.radius.control,
  fontSize: compactTypography.body.size,
  fontFamily: 'inherit',
});

const button = (): CSSProperties => ({
  minHeight: 52,
  background: tokens.color.surface,
  border: `2px solid ${tokens.color.textPrimary}`,
  borderRadius: tokens.radius.control,
  color: tokens.color.textPrimary,
  fontSize: compactTypography.control.size,
  fontWeight: Number(compactTypography.control.weight),
  cursor: 'pointer',
});

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
  const [personId, setPersonId] = useState(people[0]?.id ?? '');
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
          style={field()}
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
          style={field()}
          value={personId}
          onChange={(e) => {
            setPersonId(e.target.value);
          }}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <Label>Due date (optional, YYYY-MM-DD)</Label>
        <input
          aria-label="Due date"
          style={field()}
          value={dueOn}
          onChange={(e) => {
            setDueOn(e.target.value.trim());
          }}
        />
        {dueValid ? null : (
          <MissingNote>Write the date as YYYY-MM-DD, or leave it empty.</MissingNote>
        )}

        {state.kind === 'done' ? <Body>{state.message}</Body> : null}
        {state.kind === 'refused' ? <MissingNote>{state.message}</MissingNote> : null}

        <button type="button" style={button()} disabled={!ready} onClick={assign}>
          {state.kind === 'busy' ? 'Assigning…' : 'Assign'}
        </button>
      </Card>

      <Heading>Assigned</Heading>
      {assigned.length === 0 ? (
        <Body muted>Nothing assigned to anyone you can see.</Body>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={headerCell}>Course</th>
              <th style={headerCell}>Person</th>
              <th style={headerCell}>Due</th>
            </tr>
          </thead>
          <tbody>
            {assigned.map((row) => (
              <tr key={row.id}>
                <td style={cell}>{row.course}</td>
                <td style={cell}>{row.person}</td>
                <td style={cell}>{row.dueOn ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
};
