#!/usr/bin/env node
/**
 * W2-H A2 — the approved-material loader: a Markdown file in, a knowledge DRAFT out, which then goes
 * through the four-eyes path that already exists (submit, then a DIFFERENT admin approves, in the
 * console's Knowledge approvals). Copy `docs/operator/knowledge-template.md`.
 *
 * **It cannot produce an approved version, and that is the database's guarantee, not this file's.**
 * `knowledge_versions_before_insert()` forces every inserted version to `draft` and blanks every
 * decision column; approval is `approve_knowledge_version`, which refuses the author and the
 * submitter. This loader inserts, reads the row back to confirm it is a draft, and calls no RPC at
 * all — not submit, not approve.
 *
 * **The shape, from `20260924000600_knowledge.sql`.** A DOCUMENT (title, type, optionally a product);
 * a VERSION of it (the text, where it came from, the date it takes effect, optionally a review date,
 * and a market — REQUIRED when the document is about a product, so one country's material is never
 * retrievable in another). The text is cut into searchable chunks at SUBMIT, by its ## headings.
 *
 *   ---
 *   title: Benchmarol — storage and handling
 *   type: product_label         (product_label, clinical_study, visual_aid, faq, objection_handling,
 *                                training_material, compliance_instruction, sop, other)
 *   product: Benchmarol         (optional; by brand or generic name)
 *   market: India               (a market by name, or: any — "any" is refused for a product)
 *   source: SmPC v3, section 6.4
 *   effective: 2026-10-01
 *   review: 2027-10-01          (optional; not before effective)
 *   ---
 *   ## Storage
 *   The approved text…
 *
 * **What it refuses, by line, before anything is written** (`checkKnowledge`, then the catalogue):
 *   missing_header / bad_header_line, missing_field (title, type, market, source, effective),
 *   example_content (title starts EXAMPLE), unknown_type, bad_date, review_before_effective,
 *   product_needs_market (a product with market "any"), empty_body;
 * and, signed in: not_admin, unknown_market, unknown_product, ambiguous_name, draft_already_open (the
 * document already has a draft or a version under review).
 *
 *   node services/api/scripts/load-knowledge.mjs <file.md>                 check only, offline
 *   LOADER_PASSWORD=… node services/api/scripts/load-knowledge.mjs <file.md> --write \
 *     --url http://127.0.0.1:54321 --key <publishable key> --email admin@company
 */
import { readFileSync } from 'node:fs';
import {
  byName,
  formatProblems,
  isExample,
  restClient,
  signIn,
  splitHeader,
  whoAmI,
} from './content-loader.mjs';

export const DOCUMENT_TYPES = [
  'product_label',
  'clinical_study',
  'visual_aid',
  'faq',
  'objection_handling',
  'training_material',
  'compliance_instruction',
  'sop',
  'other',
];

const isDate = (s) =>
  /^\d{4}-\d{2}-\d{2}$/u.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/**
 * Parse and check a knowledge file. Pure: every refusal, by line. No network.
 * @param {string} text
 */
export const checkKnowledge = (text) => {
  const { header, body, problems } = splitHeader(text);
  const v = (k) => header[k]?.value ?? '';
  const line = (k) => header[k]?.line ?? 1;
  const doc = {
    title: v('title'),
    type: v('type'),
    product: v('product'),
    market: v('market'),
    source: v('source'),
    effective: v('effective'),
    review: v('review'),
    body: body.trim(),
  };
  if (problems.some((p) => p.code === 'missing_header')) return { doc, problems };
  for (const k of ['title', 'type', 'market', 'source', 'effective']) {
    if (v(k) === '') {
      problems.push({
        code: 'missing_field',
        line: 1,
        detail: `no "${k}:" in the header${k === 'market' ? ' — name a market, or write "any"' : ''}`,
      });
    }
  }
  if (doc.title !== '' && isExample(doc.title)) {
    problems.push({
      code: 'example_content',
      line: line('title'),
      detail: `"${doc.title}" is the template's example — load your company's approved material, not the sample`,
    });
  }
  if (doc.type !== '' && !DOCUMENT_TYPES.includes(doc.type)) {
    problems.push({
      code: 'unknown_type',
      line: line('type'),
      detail: `"${doc.type}" is not one of ${DOCUMENT_TYPES.join(', ')}`,
    });
  }
  for (const k of ['effective', 'review']) {
    if (v(k) !== '' && !isDate(v(k)))
      problems.push({
        code: 'bad_date',
        line: line(k),
        detail: `"${v(k)}" is not a date written YYYY-MM-DD`,
      });
  }
  if (isDate(doc.effective) && isDate(doc.review) && doc.review < doc.effective) {
    problems.push({
      code: 'review_before_effective',
      line: line('review'),
      detail: `review ${doc.review} is before effective ${doc.effective}`,
    });
  }
  if (doc.product !== '' && doc.market.toLowerCase() === 'any') {
    problems.push({
      code: 'product_needs_market',
      line: line('market'),
      detail: 'material about a product must name the market it is approved for, never "any"',
    });
  }
  if (doc.body === '')
    problems.push({ code: 'empty_body', line: 1, detail: 'the file has no text after the header' });
  return { doc, problems };
};

/**
 * Check against the company, then write the document (if new) and a DRAFT version. Throws on any
 * refusal; writes NOTHING unless every check passed.
 */
export const loadKnowledge = async (doc, { url, apiKey, email, password, fetchImpl }) => {
  const session = await signIn({ url, apiKey, email, password, fetchImpl });
  const rest = restClient({ url, apiKey, token: session.token, fetchImpl });
  const problems = [];
  const me = await whoAmI(rest, session.userId);
  if (me?.role !== 'admin')
    problems.push({
      code: 'not_admin',
      line: 1,
      detail: `${email} is not an admin of a company — only an admin writes approved material`,
    });

  let marketId = null;
  if (doc.market.toLowerCase() !== 'any') {
    const market = await byName(rest, 'markets', doc.market);
    if (market === null)
      problems.push({
        code: 'unknown_market',
        line: 1,
        detail: `your company has no market called "${doc.market}"`,
      });
    else if (market === 'ambiguous')
      problems.push({
        code: 'ambiguous_name',
        line: 1,
        detail: `more than one market is called "${doc.market}"`,
      });
    else marketId = market.id;
  }
  let productId = null;
  if (doc.product !== '') {
    const product = await byName(rest, 'products', doc.product);
    if (product === null)
      problems.push({
        code: 'unknown_product',
        line: 1,
        detail: `your company has no product called "${doc.product}"`,
      });
    else if (product === 'ambiguous')
      problems.push({
        code: 'ambiguous_name',
        line: 1,
        detail: `more than one product is called "${doc.product}"`,
      });
    else productId = product.id;
  }
  const existing = (await rest.get('knowledge_documents?select=id,title,document_type')).find(
    (d) =>
      String(d.title).trim().toLowerCase() === doc.title.trim().toLowerCase() &&
      d.document_type === doc.type,
  );
  if (existing !== undefined) {
    const open = await rest.get(
      `knowledge_document_versions?select=version_number,status&document_id=eq.${existing.id}&status=in.(draft,in_review)`,
    );
    if (open.length > 0) {
      problems.push({
        code: 'draft_already_open',
        line: 1,
        detail: `"${doc.title}" already has version ${String(open[0].version_number)} ${String(open[0].status)} — finish it in Knowledge approvals first`,
      });
    }
  }
  if (problems.length > 0) {
    const error = new Error(`NOTHING WRITTEN. Refused:\n${formatProblems(problems)}`);
    error.problems = problems;
    throw error;
  }

  const documentId =
    existing?.id ??
    (
      await rest.insert('knowledge_documents', {
        title: doc.title,
        document_type: doc.type,
        product_id: productId,
      })
    ).id;
  // organisation_id and created_by are derived by the database's trigger; status is FORCED to draft.
  const version = await rest.insert('knowledge_document_versions', {
    document_id: documentId,
    organisation_id: me.organisation_id,
    created_by_user_id: session.userId,
    market_id: marketId,
    body: doc.body,
    source_reference: doc.source,
    effective_from: doc.effective,
    review_due_on: doc.review === '' ? null : doc.review,
  });
  const [held] = await rest.get(
    `knowledge_document_versions?select=id,version_number,status&id=eq.${version.id}`,
  );
  if (held?.status !== 'draft')
    throw new Error(`the version came back "${String(held?.status)}", not draft`);
  return {
    documentId,
    versionId: version.id,
    versionNumber: held.version_number,
    status: held.status,
  };
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const opt = (name) => args[args.indexOf(name) + 1];
  if (file === undefined) {
    console.error(
      'usage: load-knowledge.mjs <file.md> [--write --url <url> --key <publishable key> --email <admin>]',
    );
    process.exit(2);
  }
  const { doc, problems } = checkKnowledge(readFileSync(file, 'utf8'));
  if (problems.length > 0) {
    console.error(
      `NOTHING WRITTEN. ${file} has ${String(problems.length)} problem(s):\n${formatProblems(problems)}`,
    );
    process.exit(1);
  }
  if (!args.includes('--write')) {
    console.log(
      `${file} is loadable: "${doc.title}" (${doc.type}), ${String(doc.body.length)} characters. Nothing written (no --write).`,
    );
    process.exit(0);
  }
  const password = process.env.LOADER_PASSWORD;
  if (password === undefined || password === '') {
    console.error(
      'LOADER_PASSWORD is not set. The admin password is read from the environment only.',
    );
    process.exit(2);
  }
  try {
    const out = await loadKnowledge(doc, {
      url: opt('--url'),
      apiKey: opt('--key'),
      email: opt('--email'),
      password,
    });
    console.log(
      `DRAFT written: "${doc.title}" version ${String(out.versionNumber)}. Submit it for review: content-step.mjs submit-knowledge "${doc.title}" — then a DIFFERENT admin approves it in Knowledge approvals (a draft does not appear there — BE-W168).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
