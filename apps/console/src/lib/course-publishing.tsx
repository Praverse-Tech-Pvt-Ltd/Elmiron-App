'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { LMS_RPC } from '@fieldforce/core';
import { browserClient } from './supabase';
import { Card, MissingNote, StatusPill } from './ui';
import {
  publishRefusal,
  versionAction,
  videoLessonLabel,
  videoTotal,
} from './course-publishing-text';
import { plural } from './plural';
import type { CourseVersionStatus, VideoLesson } from './course-publishing-text';
import { btn } from './theme-css';

/**
 * The client half of `/courses`: publish a draft course version, retire a published one. Each is
 * the RPC and nothing else; the server decides who may (an admin of the course's company) and
 * whether the version has lessons to take.
 *
 * `FE-W164`: `canChange` is false for a manager, who reads the list and is offered no button — the
 * page says once that publishing is an admin's. The function still refuses a manager whatever is
 * drawn. `FE-W171`: the Version cell is the version ("v2"), not the title again, and the videos are
 * a count with the list behind it rather than a paragraph of lesson names in a table cell.
 */
export interface CourseVersionRow {
  readonly id: string;
  readonly course: string;
  readonly version: number;
  readonly title: string;
  readonly status: CourseVersionStatus;
  readonly lessons: number;
  /** `FE-W128` — the lessons of this version that carry a video (`BE-W208`), in order. */
  readonly videos: readonly VideoLesson[];
}

const label = (action: 'publish' | 'retire', busy: boolean): string => {
  if (action === 'publish') return busy ? 'Publishing…' : 'Publish';
  return busy ? 'Retiring…' : 'Retire';
};

const VersionLine = ({
  row,
  canChange,
}: {
  readonly row: CourseVersionRow;
  readonly canChange: boolean;
}): ReactNode => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const action = canChange ? versionAction(row.status) : null;
  const total = videoTotal(row.videos);

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
      <td>{row.course}</td>
      <td className="ff-nowrap" title={row.title}>{`v${String(row.version)}`}</td>
      <td className="ff-num">{String(row.lessons)}</td>
      <td>
        {row.videos.length === 0 ? (
          <span className="ff-muted">None</span>
        ) : (
          <details>
            <summary>
              {plural(row.videos.length, 'video', 'videos')}
              {total === null ? '' : ` · ${total}`}
            </summary>
            <ul className="ff-plain-list">
              {row.videos.map((v) => (
                <li key={v.lesson}>{videoLessonLabel(v)}</li>
              ))}
            </ul>
          </details>
        )}
      </td>
      <td>
        <StatusPill status={row.status} />
      </td>
      {canChange ? (
        <td>
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
      ) : null}
    </tr>
  );
};

export const CoursePublishing = ({
  rows,
  canChange = true,
}: {
  readonly rows: readonly CourseVersionRow[];
  readonly canChange?: boolean;
}): ReactNode =>
  rows.length === 0 ? (
    <MissingNote tone="info">
      No course has been loaded yet. When one is, its versions are listed here to publish.
    </MissingNote>
  ) : (
    <Card>
      <table>
        <thead>
          <tr>
            <th>Course</th>
            <th>Version</th>
            <th className="ff-num">Lessons</th>
            <th>Videos</th>
            <th>Status</th>
            {canChange ? <th>Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <VersionLine canChange={canChange} key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </Card>
  );
