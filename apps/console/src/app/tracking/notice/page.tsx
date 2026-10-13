import type { ReactNode } from 'react';
import { LIVE_TRACKING_RPC, LiveTrackingNoticesSchema } from '@fieldforce/core';
import { signedIn } from '../../../lib/session';
import { Body, Card, Heading, MissingNote, Pill, Title } from '../../../lib/ui';
import { NoticeText, NoticeVersionCard, ProposeNotice } from '../../../lib/tracking-notice';
import { REACCEPT_NOTE, noticeRefusal, when } from '../../../lib/tracking-notice-text';

/**
 * `FE-W91` / `BE-W201` — the company's own live location notice: what is in force, the versions
 * loaded, loading a new one, and a SECOND admin approving it (`BE-W180`'s four eyes).
 *
 * **Admin only, by the database.** `live_tracking_notices` refuses anybody else `42501`, and the
 * page says so in words rather than drawing an empty list — an empty list would claim the company
 * has no versions. Which notice is "in force" is the server's answer (`current_live_tracking_notice`:
 * the latest approval, else the engineering draft); nothing here recomputes it.
 */
export const dynamic = 'force-dynamic';

export default async function TrackingNotice(): Promise<ReactNode> {
  const session = await signedIn();
  const header = (
    <div className="ff-page-header-text">
      <Title>Live location notice</Title>
      <Body muted>
        The notice each rep reads and accepts before their location is shared during working hours.
        One admin loads your company’s text; a different admin approves it.{' '}
        <a href="/tracking">Back to live location</a>.
      </Body>
    </div>
  );
  const page = (children: ReactNode): ReactNode => (
    <div className="ff-page ff-page-medium">
      {header}
      {children}
    </div>
  );

  if (session === null) {
    return page(
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>,
    );
  }

  const result = await session.db.rpc(LIVE_TRACKING_RPC.notices);
  if (result.error !== null) {
    return page(<MissingNote tone="critical">{noticeRefusal(result.error)}</MissingNote>);
  }
  const { current, versions } = LiveTrackingNoticesSchema.parse(result.data);
  const waiting = versions.filter((v) => v.status === 'waiting').length;

  return page(
    <>
      <MissingNote tone="info">{REACCEPT_NOTE}</MissingNote>

      <Card>
        <div className="ff-row">
          <Heading>In force now{current === null ? '' : `: ${current.versionLabel}`}</Heading>
          {current === null ? null : current.isDraft ? (
            <Pill tone="attention">Engineering draft — not approved</Pill>
          ) : (
            <Pill tone="success">Your company’s, approved</Pill>
          )}
        </div>
        {current === null ? (
          <MissingNote>No notice is in force, so no rep can accept one.</MissingNote>
        ) : current.isDraft ? (
          <>
            <MissingNote>
              Your company has not approved its own notice, so reps are shown the engineering DRAFT,
              labelled as a draft, with its blanks. Load your company’s text below and have a second
              admin approve it.
            </MissingNote>
            <NoticeText body={current.body} />
          </>
        ) : (
          <>
            <Body muted>
              Approved on {current.approvedAt === null ? '—' : when(current.approvedAt)}.
            </Body>
            <NoticeText body={current.body} />
          </>
        )}
      </Card>

      <ProposeNotice />

      {/* One list, newest first, so a card that is approved stays where it is (and keeps its
          "Approved" message) when the page refreshes underneath it. */}
      <div className="ff-stack">
        <Heading>Your company’s versions, newest first</Heading>
        <Body muted>
          {waiting === 0
            ? 'No version is waiting for a second admin.'
            : `${String(waiting)} version(s) waiting for a second admin.`}
        </Body>
        {versions.map((v) => (
          <NoticeVersionCard key={v.id} version={v} />
        ))}
      </div>
    </>,
  );
}
