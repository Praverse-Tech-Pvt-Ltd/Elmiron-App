import type { ReactNode } from 'react';
import { signedIn } from '../../../lib/session';
import { callerRole } from '../../../lib/role';
import { Body, MissingNote, Page, PageHeader, RoleNote } from '../../../lib/ui';
import { NOT_ADMIN_NOTE, ROUTING_NOTE } from '../../../lib/adverse-events-text';
import { AdverseEventReader } from '../../../lib/adverse-event-reader';

/**
 * `FE-W204` — one side-effect flag. The server renders the frame only; the flag itself is read in
 * the browser by `read_adverse_event` with the reason the admin types (`adverse-event-reader.tsx`),
 * so the rep's words never pass through this render, the URL or a cache. A manager is told whose
 * these are without the page asking a function that would refuse them.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Side-effect flag' };

export default async function AdverseEvent({
  params,
}: {
  readonly params: Promise<{ readonly eventId: string }>;
}): Promise<ReactNode> {
  const { eventId } = await params;
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const role = await callerRole();
  const header = (
    <PageHeader title="Side-effect flag">
      <Body muted>
        A possible side effect flagged after a visit. <a href="/adverse-events">All flags</a>
      </Body>
    </PageHeader>
  );
  if (role === 'field_manager' || role === 'mr') {
    return (
      <Page width="medium">
        {header}
        <RoleNote>{NOT_ADMIN_NOTE}</RoleNote>
      </Page>
    );
  }

  return (
    <Page width="medium">
      {header}
      <MissingNote>{ROUTING_NOTE}</MissingNote>
      {/^[0-9a-f-]{36}$/iu.test(eventId) ? (
        <AdverseEventReader eventId={eventId} />
      ) : (
        <MissingNote tone="info">No side-effect flag has this reference.</MissingNote>
      )}
    </Page>
  );
}
