/**
 * The narrow slice of `supabase-js` this app's write path uses, and how it is resolved.
 *
 * Declared as interfaces rather than importing the client's types so the modules that
 * talk to the server can be unit-tested without a client, a network or an `.env`. The
 * real client satisfies these structurally — no cast is needed at the call site, which is
 * the point of keeping them this narrow.
 */

/** `rpc()` — used for the paths where a `SECURITY DEFINER` function is the only door. */
export interface RpcCaller {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string | null; message: string } | null }>;
}

/**
 * `from().insert()/update().select()` — used where the table itself has policies.
 *
 * Both shapes exist because the schema uses both, deliberately: check-in goes through an
 * RPC because work-hours, geofence and duration are enforced there and a client must not
 * be able to skip them; a visit is an ordinary insert because `visits` carries INSERT,
 * SELECT and UPDATE policies that say everything the server needs to say.
 */
export interface TableWriter {
  from(table: string): {
    insert(values: Record<string, unknown>): {
      select(): {
        single(): PromiseLike<{
          data: unknown;
          error: { code?: string | null; message: string } | null;
        }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): {
        select(): {
          single(): PromiseLike<{
            data: unknown;
            error: { code?: string | null; message: string } | null;
          }>;
        };
      };
    };
  };
}

export type SupabaseLike = RpcCaller & TableWriter;

/**
 * The live client, imported on use rather than at module load.
 *
 * `../supabase` imports `../config`, which calls `loadAppConfig` at module load and throws
 * on a missing `EXPO_PUBLIC_*` value — deliberately, so a misconfigured build fails on the
 * first screen rather than silently. That is right for the app and wrong for a unit test,
 * which has no `.env` and does not need one to check a mapping. Importing on use keeps both.
 */
export const resolveClient = async <T>(provided?: T): Promise<T> => {
  if (provided !== undefined) return provided;
  const { supabase } = await import('../supabase');
  return supabase as T;
};
