import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `FE-W10` — the console must not tell its user that a screen it ships is forbidden.
 *
 * **What was wrong.** `admin/page.tsx` carried a card headed *"The manager console is not
 * here"*, saying `§3.6` forbids the coaching queue and the analysis review and that *"the
 * 3 September decision reopened only the MR's own screens"*. Both halves were false by the end
 * of the same day: `docs/fe-w3-spec.md` records a **second reversal, on 3 September**, which
 * reopened `E1` and `E2` explicitly and says *"Both are now built, in `apps/console`"*. They
 * are — `src/app/coaching/page.tsx` and `src/app/coaching/[analysisId]/page.tsx`.
 *
 * So the console told its user that two screens sitting one click away did not exist. In a
 * product whose pitch is that it does not overclaim, that is the worst possible defect to have.
 *
 * **Why this is a source check rather than a render check.** The console's pages are React
 * Server Components; `vitest.config.ts` says in its own comment that exercising those needs a
 * browser or a Next harness and that neither exists. Adding one is a dependency, which this
 * project requires asking about first. So this reads the sources — and because that is the
 * weaker kind of assertion, it carries both a precondition and a positive control.
 */

const APP = dirname(fileURLToPath(import.meta.url));

/** Every `page.tsx` under `src/app`, found rather than listed. */
const pages = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return pages(full);
    return entry === 'page.tsx' ? [full] : [];
  });

const ROUTES = pages(APP);

describe('FE-W10 — the console does not deny a screen it ships', () => {
  it('found the pages it is about to assert on', () => {
    // The precondition. Without it, a wrong directory or a renamed file makes every assertion
    // below pass against an empty list -- the failure mode this repo has recorded twice.
    expect(ROUTES.length).toBeGreaterThanOrEqual(3);
  });

  it('ships the two screens the card claimed were forbidden', () => {
    // The positive control, and the reason the removal was correct. If E1 and E2 were NOT
    // built, the card would have been true and deleting it would have been the defect.
    const joined = ROUTES.join('|').replaceAll('\\', '/');
    expect(joined).toMatch(/app\/coaching\/page\.tsx/u);
    expect(joined).toMatch(/app\/coaching\/\[analysisId\]\/page\.tsx/u);
  });

  it('claims nowhere that the manager console is absent', () => {
    const offenders = ROUTES.filter((file) =>
      /manager console is not here/iu.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('still renders the admin surface it is supposed to, so this did not pass by deletion', () => {
    // The second positive control. Removing a card by emptying the file would satisfy the
    // assertion above and break the product; this fails if that happens.
    const admin = ROUTES.find((file) => file.replaceAll('\\', '/').includes('app/admin/page.tsx'));
    expect(admin).toBeDefined();
    const source = readFileSync(admin ?? '', 'utf8');
    expect(source).toMatch(/Audio is purged automatically/u);
    expect(source).toMatch(/export default/u);
  });
});
