'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { LMS_RPC } from '@fieldforce/core';
import { browserClient } from './supabase';
import { MissingNote, cell, headerCell, StatusPill } from './ui';
import { publishRefusal, versionAction } from './course-publishing-text';
import type { CourseVersionStatus } from './course-publishing-text';
import { btn } from './theme-css';

/**
 * The client half of `/courses`: publish a draft course version, retire a published one. Each is
 * the RPC and nothing else; the server decides who may (an admin of the course's company) and
 * whether the version has lessons to take.
 */
export interface CourseVersionRow {
  readonly id: string;
  readonly course: string;
  readonly version: number;
  readonly title: string;
  readonly status: CourseVersionStatus;
  readonly lessons: number;
}

const label = (action: 'publish' | 'retire', busy: boolean): string => {
  if (action === 'publish') return busy ? 'Publishing…' : 'Publish';
  return busy ? 'Retiring…' : 'Retire';
};

const VersionLine = ({ row }: { readonly row: CourseVersionRow }): ReactNode => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const action = versionAction(row.status);

  const act = (): void => {
    if (action === null) return;
    setBusy(true);
    setRefused(null);
    void browserClient()
      .rpc(action === 'publish' ? LMS_RPC.publishCourseVersion : LMS_RPC.retireCourseVersion, {
        p_course_version_id: row.id,
      })
      .then(({ error }) => {
        setBusy(false);
        if (error !== null) {
          setRefused(publishRefusal(error));
          return;
        }
        router.refresh();
      });
  };

  return (
    <tr>
      <td style={cell}>{row.course}</td>
      <td style={cell}>{`v${String(row.version)} — ${row.title}`}</td>
      <td style={cell}>{String(row.lessons)}</td>
      <td style={cell}>
        <StatusPill status={row.status} />
      </td>
      <td style={cell}>
        {action === null ? null : (
          <button
            disabled={busy}
            onClick={act}
            className={btn(action === 'retire' ? 'danger' : 'primary')}
            type="button"
          >
            {label(action, busy)}
          </button>
        )}
        {refused === null ? null : <MissingNote tone="critical">{refused}</MissingNote>}
      </td>
    </tr>
  );
};

export const CoursePublishing = ({
  rows,
}: {
  readonly rows: readonly CourseVersionRow[];
}): ReactNode =>
  rows.length === 0 ? (
    <MissingNote>
      No course has been loaded yet. Courses are written with the course loader
      (services/api/scripts/load-course.mjs) and published here.
    </MissingNote>
  ) : (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <th style={headerCell}>Course</th>
          <th style={headerCell}>Version</th>
          <th style={headerCell}>Lessons</th>
          <th style={headerCell}>Status</th>
          <th style={headerCell}>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <VersionLine key={row.id} row={row} />
        ))}
      </tbody>
    </table>
  );
