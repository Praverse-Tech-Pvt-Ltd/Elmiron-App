import type { ReactNode } from 'react';
import { Body, Page, PageHeader } from '../lib/ui';
import { btn } from '../lib/theme-css';

/**
 * `FE-W169` — an address with no page behind it, in the console's own frame.
 *
 * It was Next's default: a black "404 | This page could not be found." on white, with no way back,
 * inside a product whose every other screen has the sidebar beside it. Rendered inside the root
 * layout, so a signed-in admin keeps the sidebar and the breadcrumb; the one way back offered is the
 * landing page, because the console does not know where the broken link came from.
 */
export const metadata = { title: 'Page not found' };

export default function NotFound(): ReactNode {
  return (
    <Page width="narrow">
      <PageHeader title="This page does not exist">
        <Body muted>
          The address may be mistyped, or the page may have moved. Nothing has been changed.
        </Body>
      </PageHeader>
      <div className="ff-row">
        <a className={btn('primary')} href="/coaching">
          Go to the coaching queue
        </a>
      </div>
    </Page>
  );
}
