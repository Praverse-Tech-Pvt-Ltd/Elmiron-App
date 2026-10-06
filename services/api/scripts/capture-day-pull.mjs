import { writeFileSync } from 'node:fs';
import { seedDay } from './seed-day.mjs';
import { DEFAULT_API_URL, DEFAULT_SERVICE_ROLE_KEY, verifySignIn } from './seed-one-mr.mjs';

/**
 * W2-D C / `BE-W158` — CAPTURES the `sync_pull` a real rep receives from the real local server, as
 * the fixture the shipped-configuration day test (`apps/field/src/routes/shipped-day.test.tsx`) is
 * fed. **Regenerate it; never edit it by hand** — a hand-edited fixture is the mock's `+05:30` again,
 * the shape the server never sends, which is how W2-B and W2-C's 5½-hour defects passed every test.
 *
 *   pnpm db:start
 *   node services/api/scripts/capture-day-pull.mjs
 *
 * What it does: `seedDay({ another: true })` builds a fresh DEMO tenant (a rep, doctors with clinic
 * addresses, a beat plan, yesterday's/today's/tomorrow's visits, a consent notice); it signs in AS THE
 * REP through GoTrue; and it calls `sync_pull` with exactly the arguments the app sends
 * (`apps/field/src/sync/pull.ts`, `callPull`: no cursor, every entity, 200 per page), walking every
 * page. The pages are written verbatim, with the instant they were captured — the test pins its clock
 * to that instant, because "today" in the fixture is the server's today at capture.
 *
 * **What it never writes:** the password or any token (only the token's decoded claims, which carry no
 * signature and authenticate nothing). Everything in the fixture is DEMO data a seed
 * fabricated on a local database (`seed-day.mjs`, "SAFETY"); the ids are random per capture.
 */

const OUT = new URL('../../../apps/field/src/routes/__fixtures__/day-pull.json', import.meta.url);
const apiUrl = process.env.SUPABASE_URL ?? DEFAULT_API_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;

const day = await seedDay({ another: true });
const accessToken = await verifySignIn(day.email, day.password, { apiUrl, serviceRoleKey });

/** One RPC as the rep, exactly as PostgREST answers the app. */
const rpcAsRep = async (fn, args) => {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${fn} ${String(response.status)}: ${JSON.stringify(body)}`);
  return body;
};

const pages = [];
let cursor = null;
for (let page = 0; page < 50; page += 1) {
  const body = await rpcAsRep('sync_pull', { p_cursor: cursor, p_entities: null, p_limit: 200 });
  pages.push({ cursor, response: body });
  if (body.hasMore !== true) break;
  cursor = body.nextCursor;
}

// The other two reads the day's screens make (`today/shift-window.ts`, the territory zone and the
// working hours; `capture/recording-permission.ts`, per visit). Captured for the same reason: an
// invented zone is how the 5½-hour defects hid.
const myShiftWindow = await rpcAsRep('my_shift_window', {});
const recordingPermission = {};
for (const visitId of day.visitIds) {
  recordingPermission[visitId] = await rpcAsRep('recording_permission', { p_visit_id: visitId });
}

// The token's CLAIMS, decoded -- never the token. Claims alone authenticate nothing (no signature);
// the app reads them (`apps/field/src/claims.ts`), so the test builds an unsigned token from these.
const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
const repUserId = claims.sub;

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      note: 'CAPTURED by services/api/scripts/capture-day-pull.mjs from the local server. Regenerate; never hand-edit.',
      capturedAt: pages[0].response.serverTime,
      repUserId,
      claims,
      visitIds: day.visitIds,
      pages,
      rpc: { my_shift_window: myShiftWindow, recording_permission: recordingPermission },
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(
  `captured ${String(pages.length)} page(s) of sync_pull for a DEMO rep -> apps/field/src/routes/__fixtures__/day-pull.json\n`,
);
