'use client';

import { startTransition } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Body, MissingNote, Page, PageHeader } from '../lib/ui';
import { btn } from '../lib/theme-css';

/**
 * `FE-W169` — when a page throws while it renders, in the console's own frame.
 *
 * Next's default is a bare "Application error" with nothing to press. This says what happened in a
 * person's words, offers the two ways on — try the page again, or leave for the landing page — and
 * gives the reference Next attaches to the server's log line (`digest`), so whoever supports the
 * console can find the cause without the person reading a stack trace.
 *
 * **It never claims a write did or did not happen.** The page that failed may have been the one
 * after a save; the honest sentence is to check, not a reassurance this file cannot verify.
 *
 * "Try again" re-asks the server (`router.refresh()`) and re-renders the segment (`reset()`), in one
 * transition: a server component that threw is only re-rendered when it is fetched again.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}): ReactNode {
  const router = useRouter();
  return (
    <Page width="narrow">
      <PageHeader title="This page could not be shown">
        <Body muted>
          Something went wrong while it loaded. If you had just saved something, check that it is
          there before doing it again.
        </Body>
      </PageHeader>
      <MissingNote tone="critical">
        The page stopped before it finished.
        {error.digest === undefined ? '' : ` Reference for support: ${error.digest}.`}
      </MissingNote>
      <div className="ff-row">
        <button
          className={btn('primary')}
          onClick={() => {
            startTransition(() => {
              router.refresh();
              reset();
            });
          }}
          type="button"
        >
          Try again
        </button>
        <a className={btn('secondary')} href="/coaching">
          Go to the coaching queue
        </a>
      </div>
    </Page>
  );
}
