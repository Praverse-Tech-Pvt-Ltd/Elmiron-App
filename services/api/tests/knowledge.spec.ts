import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ApproveKnowledgeVersionResponseSchema,
  RejectKnowledgeVersionResponseSchema,
  RetireKnowledgeVersionResponseSchema,
  SearchApprovedKnowledgeResponseSchema,
  SubmitKnowledgeVersionResponseSchema,
} from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * AI-C1 — approved knowledge (`20260924000600_knowledge.sql`).
 *
 * The property: **an AI feature can only ever be handed text that a second person approved, for
 * the market it is being asked about, that is in date.** Everything else — drafts, versions under
 * review, rejected and retired versions, another market's label, another company's documents,
 * content past its review date or not yet effective — must be invisible to the search, and the
 * search must say `not_available` rather than reach outside its scope.
 *
 * Every exclusion below is paired with the same query succeeding once the one thing that excludes
 * it is removed, so a zero is a rule and not a broken search.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const sqlstate = async (client: Client, sql: string, params: unknown[] = []) => {
  await client.query('savepoint probe');
  try {
    await client.query(sql, params);
    await client.query('release savepoint probe');
    return null;
  } catch (error) {
    await client.query('rollback to savepoint probe');
    return (error as { code?: string }).code ?? 'unknown';
  }
};

const rpc = async <T = Record<string, unknown>>(
  client: Client,
  fn: string,
  args: unknown[],
): Promise<T> => {
  const placeholders = args.map((_, i) => `$${String(i + 1)}`).join(', ');
  const r = await client.query<{ result: T }>(
    `select public.${fn}(${placeholders}) as result`,
    args,
  );
  return r.rows[0]?.result as T;
};

/** A second admin in the fixture organisation: the reviewer four-eyes requires. */
const makeReviewer = async (client: Client): Promise<ProfileLike> => {
  const id = randomUUID();
  await asOwner(client, async () => {
    await client.query(
      `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
      [id, `reviewer-${id.slice(0, 8)}@example.test`],
    );
    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
       values ($1, 'Reviewer Admin', 'admin', null, true, $2)`,
      [id, world.organisationId],
    );
  });
  return { id, role: 'admin', territoryId: null, isActive: true };
};

interface Scope {
  india: string;
  uae: string;
  productId: string;
}

const makeScope = async (client: Client): Promise<Scope> => {
  await asUser(client, world.users.admin);
  const s = { india: randomUUID(), uae: randomUUID(), productId: randomUUID() };
  await client.query(
    `insert into public.markets (id, country_code, name) values ($1, 'IN', 'India')`,
    [s.india],
  );
  await client.query(
    `insert into public.markets (id, country_code, name) values ($1, 'AE', 'UAE')`,
    [s.uae],
  );
  await client.query(`insert into public.products (id, brand_name) values ($1, 'Probexa')`, [
    s.productId,
  ]);
  return s;
};

interface Doc {
  documentId: string;
  versionId: string;
}

/** A document with one DRAFT version, written by `author`. */
const draftDoc = async (
  client: Client,
  author: FixtureUser | ProfileLike,
  opts: {
    body?: string;
    productId?: string | null;
    marketId?: string | null;
    effectiveFrom?: string;
    reviewDueOn?: string | null;
    documentId?: string;
    type?: string;
  } = {},
): Promise<Doc> => {
  await asUser(client, author);
  const documentId = opts.documentId ?? randomUUID();
  if (opts.documentId === undefined) {
    await client.query(
      `insert into public.knowledge_documents (id, title, document_type, product_id)
       values ($1, 'Probe document', $2, $3)`,
      [documentId, opts.type ?? 'faq', opts.productId ?? null],
    );
  }
  const versionId = randomUUID();
  await client.query(
    `insert into public.knowledge_document_versions
       (id, document_id, organisation_id, market_id, body, source_reference, effective_from,
        review_due_on, created_by_user_id)
     values ($1, $2, $3, $4, $5, 'Synthetic test source', $6, $7, $8)`,
    [
      versionId,
      documentId,
      randomUUID(), // ignored: derived from the document
      opts.marketId ?? null,
      opts.body ?? 'Probexa storage: keep below 25 degrees.',
      opts.effectiveFrom ?? '2026-01-01',
      opts.reviewDueOn ?? null,
      randomUUID(), // ignored: the author is the caller
    ],
  );
  return { documentId, versionId };
};

/** Draft by the fixture admin, submitted, approved by `reviewer`. */
const approvedDoc = async (
  client: Client,
  reviewer: ProfileLike,
  opts: Parameters<typeof draftDoc>[2] = {},
): Promise<Doc> => {
  const d = await draftDoc(client, world.users.admin, opts);
  await rpc(client, 'submit_knowledge_version', [d.versionId]);
  await asUser(client, reviewer);
  await rpc(client, 'approve_knowledge_version', [d.versionId, 'Reviewed against source.']);
  return d;
};

interface SearchResult {
  status: 'found' | 'not_available';
  results: { documentVersionId: string; heading: string | null; body: string }[];
}

const search = async (
  client: Client,
  user: FixtureUser | ProfileLike,
  query: string,
  marketId: string | null = null,
  productId: string | null = null,
): Promise<SearchResult> => {
  await asUser(client, user);
  return rpc<SearchResult>(client, 'search_approved_knowledge', [query, marketId, productId, 5]);
};

const versionsIn = (r: SearchResult) => r.results.map((x) => x.documentVersionId);

describe.skipIf(!reachable)('AI-C1 — review and approval', () => {
  it('four eyes: the author cannot approve; a second admin can, with an attestation', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      const d = await draftDoc(client, world.users.admin);
      await rpc(client, 'submit_knowledge_version', [d.versionId]);

      expect(
        await sqlstate(client, 'select public.approve_knowledge_version($1, $2)', [
          d.versionId,
          'I wrote it and I approve it.',
        ]),
        'the author',
      ).toBe('42501');

      await asUser(client, reviewer);
      expect(
        await sqlstate(client, 'select public.approve_knowledge_version($1, $2)', [
          d.versionId,
          '  ',
        ]),
        'no attestation',
      ).toBe('22023');

      const out = await rpc<{ status: string }>(client, 'approve_knowledge_version', [
        d.versionId,
        'Checked against the approved label, section 6.',
      ]);
      expect(out.status).toBe('approved');

      const row = await client.query<{ decided_by_user_id: string; approval_attestation: string }>(
        `select decided_by_user_id, approval_attestation from public.knowledge_document_versions where id = $1`,
        [d.versionId],
      );
      expect(row.rows[0]).toEqual({
        decided_by_user_id: reviewer.id,
        approval_attestation: 'Checked against the approved label, section 6.',
      });
    });
  });

  it('four eyes holds even for the table owner, as a constraint', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await draftDoc(client, world.users.admin);
      await rpc(client, 'submit_knowledge_version', [d.versionId]);
      const code = await asOwner(client, () =>
        sqlstate(
          client,
          `update public.knowledge_document_versions
              set status = 'approved', decided_at = now(), decided_by_user_id = $2,
                  approval_attestation = 'self'
            where id = $1`,
          [d.versionId, world.users.admin.id],
        ),
      );
      expect(code).toBe('23514');
    });
  });

  it('only an admin of the organisation manages knowledge', async () => {
    await inRolledBackTransaction(async (client) => {
      const d = await draftDoc(client, world.users.admin);
      for (const user of [world.users.puneMr, world.users.westManager, world.users.rivalAdmin]) {
        await asUser(client, user);
        expect(
          await sqlstate(client, 'select public.submit_knowledge_version($1)', [d.versionId]),
          user.role,
        ).toBe('42501');
      }
      await asUser(client, world.users.puneMr);
      expect(
        await sqlstate(
          client,
          `insert into public.knowledge_documents (title, document_type) values ('MR doc', 'faq')`,
        ),
      ).toBe('42501');
    });
  });

  it('submitting freezes the text; a rejected version is terminal; approval retires the previous one', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      const d = await draftDoc(client, world.users.admin);
      // Positive control: a draft is editable.
      expect(
        await sqlstate(
          client,
          `update public.knowledge_document_versions set body = 'Edited.' where id = $1`,
          [d.versionId],
        ),
      ).toBeNull();
      await rpc(client, 'submit_knowledge_version', [d.versionId]);
      expect(
        await sqlstate(
          client,
          `update public.knowledge_document_versions set body = 'Late.' where id = $1`,
          [d.versionId],
        ),
        'in review',
      ).toBe('23514');
      expect(
        await sqlstate(
          client,
          `update public.knowledge_document_versions set status = 'approved' where id = $1`,
          [d.versionId],
        ),
        'status is not in the grant',
      ).toBe('42501');

      await asUser(client, reviewer);
      await rpc(client, 'reject_knowledge_version', [d.versionId, 'Cites a withdrawn study.']);
      expect(
        await sqlstate(client, 'select public.approve_knowledge_version($1, $2)', [
          d.versionId,
          'x',
        ]),
        'a rejection is final',
      ).toBe('22023');

      const v1 = await approvedDoc(client, reviewer, { documentId: d.documentId });
      const v2 = await draftDoc(client, world.users.admin, { documentId: d.documentId });
      await rpc(client, 'submit_knowledge_version', [v2.versionId]);
      await asUser(client, reviewer);
      const out = await rpc<{ retiredDocumentVersionIds: string[] }>(
        client,
        'approve_knowledge_version',
        [v2.versionId, 'Replaces v1.'],
      );
      expect(out.retiredDocumentVersionIds).toEqual([v1.versionId]);
    });
  });

  it('content about a product must name its market', async () => {
    await inRolledBackTransaction(async (client) => {
      const s = await makeScope(client);
      await asUser(client, world.users.admin);
      const documentId = randomUUID();
      await client.query(
        `insert into public.knowledge_documents (id, title, document_type, product_id)
         values ($1, 'Probexa label', 'product_label', $2)`,
        [documentId, s.productId],
      );
      expect(
        await sqlstate(
          client,
          `insert into public.knowledge_document_versions
             (document_id, body, source_reference, effective_from, created_by_user_id)
           values ($1, 'Label text.', 'Label v3', '2026-01-01', $2)`,
          [documentId, world.users.admin.id],
        ),
        'no market',
      ).toBe('23514');
      expect(
        await sqlstate(
          client,
          `insert into public.knowledge_document_versions
             (document_id, market_id, body, source_reference, effective_from, created_by_user_id)
           values ($1, $2, 'Label text.', 'Label v3', '2026-01-01', $3)`,
          [documentId, s.india, world.users.admin.id],
        ),
        'with a market',
      ).toBeNull();
    });
  });

  it('chunks keep their section heading, and the heading line is not body', async () => {
    await inRolledBackTransaction(async (client) => {
      const body = [
        '# Storage',
        'Keep below 25 degrees.',
        'Protect from light.',
        '## Handling',
        'Do not crush the tablet.',
      ].join('\n\n');
      const d = await draftDoc(client, world.users.admin, { body });
      const out = await rpc<{ chunkCount: number }>(client, 'submit_knowledge_version', [
        d.versionId,
      ]);
      expect(out.chunkCount).toBe(2);
      const chunks = await client.query<{ position: number; heading: string; body: string }>(
        `select position, heading, body from public.knowledge_chunks
          where document_version_id = $1 order by position`,
        [d.versionId],
      );
      expect(chunks.rows).toEqual([
        { position: 1, heading: 'Storage', body: 'Keep below 25 degrees.\n\nProtect from light.' },
        { position: 2, heading: 'Handling', body: 'Do not crush the tablet.' },
      ]);
      const code = await asOwner(client, () =>
        sqlstate(
          client,
          `update public.knowledge_chunks set body = 'x' where document_version_id = $1`,
          [d.versionId],
        ),
      );
      expect(code, 'chunks are append-only').toBe('23001');
    });
  });
});

describe.skipIf(!reachable)('AI-C1 — the search returns only what may be said', () => {
  it('finds approved text, and never a draft, one under review, or a rejected one', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      const approved = await approvedDoc(client, reviewer, { body: 'Zephyrine dosing guidance.' });
      const draft = await draftDoc(client, world.users.admin, { body: 'Zephyrine draft text.' });
      const review = await draftDoc(client, world.users.admin, { body: 'Zephyrine review text.' });
      await rpc(client, 'submit_knowledge_version', [review.versionId]);
      const rejected = await draftDoc(client, world.users.admin, {
        body: 'Zephyrine rejected text.',
      });
      await rpc(client, 'submit_knowledge_version', [rejected.versionId]);
      await asUser(client, reviewer);
      await rpc(client, 'reject_knowledge_version', [rejected.versionId, 'Unsupported claim.']);

      const r = await search(client, world.users.puneMr, 'zephyrine');
      expect(r.status).toBe('found');
      expect(versionsIn(r)).toEqual([approved.versionId]);
      expect(versionsIn(r)).not.toContain(draft.versionId);
    });
  });

  it('respects the market: India content is not an answer in the UAE, and product content needs a market', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      const s = await makeScope(client);
      const india = await approvedDoc(client, reviewer, {
        productId: s.productId,
        marketId: s.india,
        type: 'product_label',
        body: 'Probexa indication text for India.',
      });

      expect(
        versionsIn(
          await search(client, world.users.puneMr, 'probexa indication', s.india, s.productId),
        ),
      ).toEqual([india.versionId]);
      const uae = await search(
        client,
        world.users.puneMr,
        'probexa indication',
        s.uae,
        s.productId,
      );
      expect(uae.status, 'another market').toBe('not_available');
      const none = await search(client, world.users.puneMr, 'probexa indication');
      expect(none.status, 'no market named').toBe('not_available');
    });
  });

  it('respects the product: another product’s content is not an answer', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      const s = await makeScope(client);
      await asUser(client, world.users.admin);
      const otherProduct = randomUUID();
      await client.query(`insert into public.products (id, brand_name) values ($1, 'Otherex')`, [
        otherProduct,
      ]);
      const d = await approvedDoc(client, reviewer, {
        productId: s.productId,
        marketId: s.india,
        body: 'Quintessal interaction note.',
      });
      expect(
        (await search(client, world.users.puneMr, 'quintessal', s.india, otherProduct)).status,
      ).toBe('not_available');
      expect(
        versionsIn(await search(client, world.users.puneMr, 'quintessal', s.india, s.productId)),
      ).toEqual([d.versionId]);
    });
  });

  it('respects the calendar: not yet effective, and past review, are both excluded', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      await approvedDoc(client, reviewer, { body: 'Futurol text.', effectiveFrom: '2099-01-01' });
      await approvedDoc(client, reviewer, {
        body: 'Stalemine text.',
        effectiveFrom: '2025-01-01',
        reviewDueOn: '2025-06-30',
      });
      const current = await approvedDoc(client, reviewer, {
        body: 'Currentyl text.',
        effectiveFrom: '2025-01-01',
        reviewDueOn: '2099-12-31',
      });
      expect((await search(client, world.users.puneMr, 'futurol')).status).toBe('not_available');
      expect((await search(client, world.users.puneMr, 'stalemine')).status).toBe('not_available');
      expect(versionsIn(await search(client, world.users.puneMr, 'currentyl'))).toEqual([
        current.versionId,
      ]);
    });
  });

  it('a retired version, or an inactive document, is no longer an answer', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      const retired = await approvedDoc(client, reviewer, { body: 'Retirol text.' });
      const inactive = await approvedDoc(client, reviewer, { body: 'Dormantine text.' });
      expect(versionsIn(await search(client, world.users.puneMr, 'retirol'))).toEqual([
        retired.versionId,
      ]);

      await asUser(client, world.users.admin);
      await rpc(client, 'retire_knowledge_version', [retired.versionId]);
      await client.query(`update public.knowledge_documents set is_active = false where id = $1`, [
        inactive.documentId,
      ]);
      expect((await search(client, world.users.puneMr, 'retirol')).status).toBe('not_available');
      expect((await search(client, world.users.puneMr, 'dormantine')).status).toBe('not_available');
    });
  });

  it('another company’s approved knowledge is never an answer, and its market cannot be named', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      await approvedDoc(client, reviewer, { body: 'Tenantol text.' });
      expect((await search(client, world.users.rivalMr, 'tenantol')).status).toBe('not_available');
      expect(
        (await search(client, world.users.puneMr, 'tenantol')).status,
        'positive control',
      ).toBe('found');

      const s = await makeScope(client);
      await asUser(client, world.users.rivalMr);
      expect(
        await sqlstate(client, 'select public.search_approved_knowledge($1, $2, null, 5)', [
          'tenantol',
          s.india,
        ]),
      ).toBe('42501');
    });
  });

  it('an MR reads the approved library directly, but not drafts or chunks under review', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      const approved = await approvedDoc(client, reviewer);
      const review = await draftDoc(client, world.users.admin);
      await rpc(client, 'submit_knowledge_version', [review.versionId]);

      await asUser(client, world.users.puneMr);
      const versions = await client.query(
        `select id from public.knowledge_document_versions where id = any($1::uuid[])`,
        [[approved.versionId, review.versionId]],
      );
      expect(versions.rows.map((r: { id: string }) => r.id)).toEqual([approved.versionId]);
      const chunks = await client.query(
        `select document_version_id from public.knowledge_chunks where document_version_id = any($1::uuid[])`,
        [[approved.versionId, review.versionId]],
      );
      expect(
        new Set(chunks.rows.map((r: { document_version_id: string }) => r.document_version_id)),
      ).toEqual(new Set([approved.versionId]));
    });
  });

  it('the text predicate can use its index for the role the search runs as, and not for a caller', async () => {
    // FIX-08: `@@` is not leakproof, so under RLS it is demoted to a post-filter and can never be
    // an index condition. That is WHY the search is `security definer`: its body runs as the owner.
    // Both halves, so the first is not a planner accident.
    await inRolledBackTransaction(async (client) => {
      const sql = `explain select c.id from public.knowledge_chunks c
                    where c.search_vector @@ websearch_to_tsquery('english', 'storage')`;
      const planText = async () =>
        (await client.query<{ 'QUERY PLAN': string }>(sql)).rows
          .map((r) => r['QUERY PLAN'])
          .join('\n');

      await client.query('set local enable_seqscan = off');
      await asOwner(client, async () => {
        expect(await planText(), 'as the owner').toMatch(/knowledge_chunks_search_idx/);
      });
      await asUser(client, world.users.puneMr);
      expect(await planText(), 'as an MR, through RLS').not.toMatch(/knowledge_chunks_search_idx/);
    });
  });
});

/** FIX-07: every RPC response, called for real, parsed with the schema the frontend builds against. */
describe.skipIf(!reachable)('AI-C1 — every RPC response matches @fieldforce/core', () => {
  it('submit, approve, reject, retire, and both shapes of search', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);

      const a = await draftDoc(client, world.users.admin, { body: '# Section\n\nShapewell text.' });
      SubmitKnowledgeVersionResponseSchema.parse(
        await rpc(client, 'submit_knowledge_version', [a.versionId]),
      );
      await asUser(client, reviewer);
      ApproveKnowledgeVersionResponseSchema.parse(
        await rpc(client, 'approve_knowledge_version', [a.versionId, 'Reviewed.']),
      );

      const b = await draftDoc(client, world.users.admin);
      await rpc(client, 'submit_knowledge_version', [b.versionId]);
      await asUser(client, reviewer);
      RejectKnowledgeVersionResponseSchema.parse(
        await rpc(client, 'reject_knowledge_version', [b.versionId, 'Out of date.']),
      );

      const found = SearchApprovedKnowledgeResponseSchema.parse(
        await search(client, world.users.puneMr, 'shapewell'),
      );
      expect(found.status).toBe('found');
      const missing = SearchApprovedKnowledgeResponseSchema.parse(
        await search(client, world.users.puneMr, 'nothingmatchesthis'),
      );
      expect(missing.status).toBe('not_available');

      await asUser(client, world.users.admin);
      RetireKnowledgeVersionResponseSchema.parse(
        await rpc(client, 'retire_knowledge_version', [a.versionId]),
      );
    });
  });
});
