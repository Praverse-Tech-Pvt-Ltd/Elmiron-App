import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { KnowledgeDocumentVersionSchema } from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W1-A E1 / E5 — **AI-generated text is never born approved** (`C23`).
 *
 * `C23` permits AI-generated text to be used extensively in the LMS as DRAFT knowledge. This suite
 * is the mechanism behind that permission. The property, in one sentence:
 *
 *   **There is no route from an INSERT to approved knowledge, for anybody, and a caller who tries
 *   is told rather than quietly given a draft.**
 *
 * Two things are asserted, and the second is what makes the first worth anything:
 *
 * 1. The refusal fires — an insert claiming `approved`, or setting any review/approval column,
 *    raises `23514`.
 * 2. **The positive control: the same insert without the claim SUCCEEDS.** Without it, a table that
 *    refused every insert for an unrelated reason would pass every assertion above and the suite
 *    would be measuring nothing.
 *
 * Both run as an `admin` — the most privileged app role — and separately as the table OWNER, which
 * holds BYPASSRLS. A trigger is not RLS, so it fires for the owner too, and a seed or a migration
 * runs as exactly that role. Asserting it for `admin` alone would leave the route a seed actually
 * takes unmeasured.
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

/** A document with no product, so the market rule cannot be the thing that refuses an insert. */
const makeDoc = async (client: Client): Promise<string> => {
  const documentId = randomUUID();
  await client.query(
    `insert into public.knowledge_documents (id, title, document_type, product_id)
     values ($1, 'Authorship probe', 'training_material', null)`,
    [documentId],
  );
  return documentId;
};

const VERSION_COLUMNS = '(document_id, body, source_reference, effective_from, created_by_user_id';
const VERSION_VALUES = "($1, 'Draft body.', 'Synthetic test source', '2026-01-01', $2";

describe.skipIf(!reachable)('W1-A E1 — no INSERT reaches approved knowledge', () => {
  it('POSITIVE CONTROL: a plain insert succeeds, and lands as a draft written by a human', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const documentId = await makeDoc(client);
      expect(
        await sqlstate(
          client,
          `insert into public.knowledge_document_versions ${VERSION_COLUMNS})
           values ${VERSION_VALUES})`,
          [documentId, world.users.admin.id],
        ),
        'the ordinary path must work, or every refusal below proves nothing',
      ).toBeNull();

      const row = await client.query<{ status: string; authorship: string }>(
        `select status, authorship from public.knowledge_document_versions
          where document_id = $1`,
        [documentId],
      );
      expect(row.rows[0]?.status).toBe('draft');
      expect(row.rows[0]?.authorship).toBe('human');
    });
  });

  it.each(['approved', 'in_review', 'retired', 'rejected'] as const)(
    'an insert claiming status %s is REFUSED, not coerced',
    async (status) => {
      await inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.admin);
        const documentId = await makeDoc(client);
        expect(
          await sqlstate(
            client,
            `insert into public.knowledge_document_versions ${VERSION_COLUMNS}, status)
             values ${VERSION_VALUES}, $3)`,
            [documentId, world.users.admin.id, status],
          ),
        ).toBe('23514');

        // And nothing was written. A refusal that left a row would be worse than a coercion.
        const n = await client.query<{ n: string }>(
          `select count(*) n from public.knowledge_document_versions where document_id = $1`,
          [documentId],
        );
        expect(n.rows[0]?.n).toBe('0');
      });
    },
  );

  it.each([
    ['approval_attestation', "'I attest this is accurate.'"],
    ['submitted_by_user_id', 'gen_random_uuid()'],
    ['decided_by_user_id', 'gen_random_uuid()'],
    ['rejection_reason', "'no'"],
  ])('an insert setting %s is REFUSED — it asks to skip the approver', async (column, value) => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const documentId = await makeDoc(client);
      expect(
        await sqlstate(
          client,
          `insert into public.knowledge_document_versions ${VERSION_COLUMNS}, ${column})
           values ${VERSION_VALUES}, ${value})`,
          [documentId, world.users.admin.id],
        ),
      ).toBe('23514');
    });
  });

  it('THE OWNER, who holds BYPASSRLS, is refused too — this is the route a seed takes', async () => {
    // `.ai-collab/constraints.md`: `postgres` and `service_role` hold BYPASSRLS, measured, so RLS
    // is never evaluated for them. A TRIGGER is not RLS and does fire — and this asserts it,
    // because "no seed, script or migration may insert approved knowledge" is a claim about
    // exactly this role and nothing else.
    await inRolledBackTransaction(async (client) => {
      await asOwner(client, async () => {
        const documentId = randomUUID();
        await client.query(
          `insert into public.knowledge_documents (id, title, document_type, product_id, organisation_id, created_by_user_id)
           values ($1, 'Owner probe', 'training_material', null, $2, $3)`,
          [documentId, world.organisationId, world.users.admin.id],
        );
        expect(
          await sqlstate(
            client,
            `insert into public.knowledge_document_versions ${VERSION_COLUMNS}, status)
             values ${VERSION_VALUES}, 'approved')`,
            [documentId, world.users.admin.id],
          ),
          'a seed running as the owner must be refused as loudly as an admin',
        ).toBe('23514');

        // Positive control for the owner path specifically: without the claim it works.
        expect(
          await sqlstate(
            client,
            `insert into public.knowledge_document_versions ${VERSION_COLUMNS})
             values ${VERSION_VALUES})`,
            [documentId, world.users.admin.id],
          ),
        ).toBeNull();
      });
    });
  });
});

describe.skipIf(!reachable)('W1-A E1 — the authorship label, C23', () => {
  it('an AI-generated draft must name its model, and a human draft must not', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const documentId = await makeDoc(client);

      expect(
        await sqlstate(
          client,
          `insert into public.knowledge_document_versions ${VERSION_COLUMNS}, authorship)
           values ${VERSION_VALUES}, 'ai_generated')`,
          [documentId, world.users.admin.id],
        ),
        'ai_generated with no model names nothing an approver can weigh',
      ).toBe('23514');

      expect(
        await sqlstate(
          client,
          `insert into public.knowledge_document_versions ${VERSION_COLUMNS}, authorship, authoring_model)
           values ${VERSION_VALUES}, 'human', 'some-model')`,
          [documentId, world.users.admin.id],
        ),
        'human WITH a model is a mislabelled machine draft, which is what C23 prevents',
      ).toBe('23514');

      // POSITIVE CONTROL: the labelled AI draft is accepted.
      expect(
        await sqlstate(
          client,
          `insert into public.knowledge_document_versions ${VERSION_COLUMNS}, authorship, authoring_model)
           values ${VERSION_VALUES}, 'ai_generated', 'some-model')`,
          [documentId, world.users.admin.id],
        ),
      ).toBeNull();
    });
  });

  it('an AI-generated draft still lands as a DRAFT — C23 in one assertion', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const documentId = await makeDoc(client);
      await client.query(
        `insert into public.knowledge_document_versions ${VERSION_COLUMNS}, authorship, authoring_model)
         values ${VERSION_VALUES}, 'ai_generated', 'some-model')`,
        [documentId, world.users.admin.id],
      );
      const row = await client.query<{ status: string }>(
        `select status from public.knowledge_document_versions where document_id = $1`,
        [documentId],
      );
      expect(row.rows[0]?.status).toBe('draft');
    });
  });

  it('the contract schema and the table agree on the two new columns', async () => {
    // `.ai-collab/constraints.md`: "When a request schema declares a required field, some column
    // must be able to consume it." The reverse holds for a read — a column the entity schema does
    // not declare is a column the console will drop on the floor.
    await inRolledBackTransaction(async (client) => {
      const cols = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'knowledge_document_versions'`,
      );
      const names = new Set(cols.rows.map((r) => r.column_name));
      expect(names.has('authorship')).toBe(true);
      expect(names.has('authoring_model')).toBe(true);
      const declared = Object.keys(KnowledgeDocumentVersionSchema.shape);
      expect(declared).toContain('authorship');
      expect(declared).toContain('authoringModel');
    });
  });
});
