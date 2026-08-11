/**
 * The one place that knows how to delete a storage object.
 *
 * Extracted in BE-W7 because both the retention worker and the post-restore
 * reconciliation delete objects, and the "already gone" case is subtler than it
 * looks — subtle enough that BE-W6 got it wrong and the bug went unnoticed because
 * the branch was never reached.
 *
 * WHAT SUPABASE STORAGE ACTUALLY RETURNS when the object is not there:
 *
 *     HTTP 400
 *     {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}
 *
 * The 404 is in the BODY. The HTTP status is 400. So a `response.status === 404`
 * check — which is the obvious thing to write, and is what BE-W6's worker had —
 * never fires, and a delete of an object somebody else already removed is treated as
 * a hard failure.
 *
 * It stayed invisible because nothing reached it: `claim_expired_audio` does not
 * re-claim a destroyed row, so the retention worker never asks twice. The
 * reconciliation, which walks the bucket rather than a claim list, reaches it
 * immediately.
 */

const isAlreadyGone = (status, body) => {
  if (status === 404) return true;
  if (status !== 400) return false;
  try {
    const parsed = JSON.parse(body);
    return (
      parsed.code === 'NoSuchKey' ||
      parsed.error === 'not_found' ||
      String(parsed.statusCode) === '404'
    );
  } catch {
    return false;
  }
};

/**
 * Deletes one object. An object that is already gone counts as success — the goal is
 * absence, not the act of deleting.
 *
 * @param {{ apiUrl: string, bucket: string, serviceKey: string }} config
 * @param {string} storageKey
 */
export const deleteStorageObject = async (config, storageKey) => {
  const response = await fetch(
    `${config.apiUrl}/storage/v1/object/${config.bucket}/${storageKey}`,
    {
      method: 'DELETE',
      headers: {
        apikey: config.serviceKey,
        authorization: `Bearer ${config.serviceKey}`,
      },
    },
  );

  if (response.ok) return;

  const body = await response.text();
  // Already removed — by a previous run, by the withdrawal cascade racing this one,
  // or by the other worker. All of them mean the same thing: the object is gone.
  if (isAlreadyGone(response.status, body)) return;

  throw new Error(`storage delete failed for ${storageKey}: ${String(response.status)} ${body}`);
};

export { isAlreadyGone };
