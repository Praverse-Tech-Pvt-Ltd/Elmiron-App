import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { serverClient } from './lib/supabase';

/**
 * MR-52 A1/A5 — refresh the session cookie, and send a signed-out browser to the sign-in page.
 *
 * **Two jobs, and only the first is load-bearing.** Refreshing is: an access token lives an hour, a
 * Server Component cannot write cookies, so without this the console would sign an admin out
 * mid-afternoon. The redirect is a courtesy — it avoids rendering a shell whose every read would be
 * refused. **It is not the access control**, and must never be mistaken for it: the server refuses
 * an unauthenticated read whatever this file does, which is what MR-52 A5 asserts against
 * PostgREST rather than against this redirect.
 */
export const config = {
  // Everything except Next's own assets. `_next/*` and favicon are served without a session.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export const middleware = async (request: NextRequest): Promise<NextResponse> => {
  const response = NextResponse.next({ request });

  const supabase = serverClient({
    getAll: () => request.cookies.getAll(),
    setAll: (written) => {
      for (const { name, value, options } of written) response.cookies.set(name, value, options);
    },
  });

  // This call is what refreshes an expiring token and writes the new cookie onto `response`.
  const { data } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isSignIn = path === '/sign-in';
  if (data.user === null && !isSignIn) {
    const to = request.nextUrl.clone();
    to.pathname = '/sign-in';
    // Where they were going, so signing in does not dump them on a different page.
    to.searchParams.set('next', path);
    return NextResponse.redirect(to);
  }
  if (data.user !== null && isSignIn) {
    const to = request.nextUrl.clone();
    to.pathname = '/';
    to.searchParams.delete('next');
    return NextResponse.redirect(to);
  }
  return response;
};

export default middleware;
