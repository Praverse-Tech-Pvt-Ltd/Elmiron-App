#!/usr/bin/env node
/**
 * W2-I A4 (`BE-W168`) — the two steps between a loaded draft and something a rep or an approver can
 * see, which no screen performs:
 *
 *   publish-course "<course title>"      the course's DRAFT version → published (reps assigned it see it)
 *   submit-knowledge "<document title>"  the document's DRAFT version → in review (it then appears in
 *                                        the console's Knowledge approvals, for a DIFFERENT admin)
 *
 * **Found, not planned.** The console lists knowledge only when it is `in_review` and has no publish
 * button for a course; nothing in `apps/` calls `publish_course_version` or `submit_knowledge_version`.
 * The loaders' own messages pointed the admin at screens that do not exist.
 *
 * **It calls the same function a button would, as the signed-in admin**, so every refusal is the
 * database's: publishing a version with no lessons, submitting someone else's draft, and so on. It
 * never approves anything — approval is four eyes, in the console.
 *
 *   LOADER_PASSWORD=… node services/api/scripts/content-step.mjs publish-course "Storage basics" \
 *     --url http://127.0.0.1:54321 --key <publishable key> --email admin@company
 */
import { restClient, signIn, whoAmI } from './content-loader.mjs';

const lower = (s) => String(s).trim().toLowerCase();

const refuse = (code, detail) => {
  const error = new Error(`NOTHING CHANGED. ${code} — ${detail}`);
  error.code = code;
  throw error;
};

/** The one draft of the one row with this title, or a refusal saying which part is missing. */
const theDraft = async (rest, { table, versions, parent, title, what }) => {
  const hits = (await rest.get(`${table}?select=id,title`)).filter(
    (r) => lower(r.title) === lower(title),
  );
  if (hits.length === 0) refuse('not_found', `your company has no ${what} called "${title}"`);
  if (hits.length > 1) refuse('ambiguous_name', `more than one ${what} is called "${title}"`);
  const drafts = await rest.get(
    `${versions}?select=id,version_number&${parent}=eq.${hits[0].id}&status=eq.draft`,
  );
  if (drafts.length === 0) refuse('no_draft', `"${title}" has no draft version to move on`);
  return drafts[0];
};

/**
 * @param {'publish-course' | 'submit-knowledge'} step
 * @param {string} title
 */
export const contentStep = async (step, title, { url, apiKey, email, password, fetchImpl }) => {
  const session = await signIn({ url, apiKey, email, password, fetchImpl });
  const rest = restClient({ url, apiKey, token: session.token, fetchImpl });
  const me = await whoAmI(rest, session.userId);
  if (me?.role !== 'admin') refuse('not_admin', `${email} is not an admin of a company`);
  if (step === 'publish-course') {
    const draft = await theDraft(rest, {
      table: 'courses',
      versions: 'course_versions',
      parent: 'course_id',
      title,
      what: 'course',
    });
    await rest.rpc('publish_course_version', { p_course_version_id: draft.id });
    const [held] = await rest.get(`course_versions?select=status&id=eq.${draft.id}`);
    if (held?.status !== 'published')
      throw new Error(`the version came back "${String(held?.status)}", not published`);
    return { versionId: draft.id, versionNumber: draft.version_number, status: held.status };
  }
  if (step === 'submit-knowledge') {
    const draft = await theDraft(rest, {
      table: 'knowledge_documents',
      versions: 'knowledge_document_versions',
      parent: 'document_id',
      title,
      what: 'document',
    });
    await rest.rpc('submit_knowledge_version', { p_version_id: draft.id });
    const [held] = await rest.get(`knowledge_document_versions?select=status&id=eq.${draft.id}`);
    if (held?.status !== 'in_review')
      throw new Error(`the version came back "${String(held?.status)}", not in_review`);
    return { versionId: draft.id, versionNumber: draft.version_number, status: held.status };
  }
  return refuse(
    'unknown_step',
    `"${String(step)}" — the steps are publish-course and submit-knowledge`,
  );
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const args = process.argv.slice(2);
  const [step, title] = args.filter(
    (a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'),
  );
  const opt = (name) => args[args.indexOf(name) + 1];
  if (step === undefined || title === undefined) {
    console.error(
      'usage: content-step.mjs <publish-course|submit-knowledge> "<title>" --url <url> --key <publishable key> --email <admin>',
    );
    process.exit(2);
  }
  const password = process.env.LOADER_PASSWORD;
  if (password === undefined || password === '') {
    console.error(
      'LOADER_PASSWORD is not set. The admin password is read from the environment only.',
    );
    process.exit(2);
  }
  try {
    const out = await contentStep(step, title, {
      url: opt('--url'),
      apiKey: opt('--key'),
      email: opt('--email'),
      password,
    });
    console.log(
      step === 'publish-course'
        ? `PUBLISHED: "${title}" version ${String(out.versionNumber)}. Assign it in the console's Learning page.`
        : `IN REVIEW: "${title}" version ${String(out.versionNumber)}. A DIFFERENT admin approves it in the console's Knowledge approvals.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
