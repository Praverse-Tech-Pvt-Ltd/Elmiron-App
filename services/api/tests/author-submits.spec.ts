import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser, withIdentityLock } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * `BE-W170` / `BE-C77` — the AUTHOR submits a draft; a DIFFERENT admin approves or rejects it.
 *
 * Before `20261009000100_author_submits`, any admin could submit any draft, and approve/reject refuse
 * the author AND the submitter — so a draft submitted by the second of two admins could never be
 * decided. Each case below runs for every content kind with a submit step: knowledge versions, AI
 * prompt versions, practice personas and practice scenarios. Courses have no submit step (Q-21).
 *
 * The organisation here has EXACTLY two admins — the fixture admin and one reviewer — which is the
 * size the rule has to work at, and the first test asserts it rather than assuming it.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

type Person = FixtureUser | ProfileLike;

/** The SQLSTATE a statement fails with, and the constraint it names — or nulls when it succeeds. */
const failure = async (client: Client, sql: string, params: unknown[] = []) => {
  await client.query('savepoint probe');
  try {
    await client.query(sql, params);
    await client.query('release savepoint probe');
    return { code: null, constraint: null };
  } catch (error) {
    await client.query('rollback to savepoint probe');
    const e = error as { code?: string; constraint?: string };
    return { code: e.code ?? 'unknown', constraint: e.constraint ?? null };
  }
};

/** The second admin, in the fixture organisation. Serialised like every suite's reviewer (`BE-W116`). */
const makeReviewer = async (client: Client): Promise<ProfileLike> =>
  withIdentityLock(async () => {
    const id = randomUUID();
    await asOwner(client, async () => {
      await client.query(
        `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
        [id, `second-admin-${id.slice(0, 8)}@example.test`],
      );
      await client.query(
        `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
         values ($1, 'Second Admin', 'admin', null, true, $2)`,
        [id, world.organisationId],
      );
    });
    return { id, role: 'admin', territoryId: null, isActive: true };
  });

interface Kind {
  readonly name: string;
  readonly table: string;
  readonly constraint: string;
  /** A draft written as `author`; returns its id. */
  readonly draft: (client: Client, author: Person) => Promise<string>;
  readonly submit: string;
  readonly approve: string;
  readonly reject: string;
}

const KINDS: readonly Kind[] = [
  {
    name: 'knowledge version',
    table: 'knowledge_document_versions',
    constraint: 'knowledge_versions_author_submits',
    draft: async (client, author) => {
      await asUser(client, author);
      const documentId = randomUUID();
      const id = randomUUID();
      await client.query(
        `insert into public.knowledge_documents (id, title, document_type) values ($1, 'BE-C77 probe', 'faq')`,
        [documentId],
      );
      await client.query(
        `insert into public.knowledge_document_versions
           (id, document_id, organisation_id, body, source_reference, effective_from, created_by_user_id)
         values ($1, $2, $3, 'Storage: keep below 25 degrees.', 'Synthetic test source', '2026-01-01', $4)`,
        [id, documentId, world.organisationId, author.id],
      );
      return id;
    },
    submit: 'select public.submit_knowledge_version($1)',
    approve: 'select public.approve_knowledge_version($1, $2)',
    reject: 'select public.reject_knowledge_version($1, $2)',
  },
  {
    name: 'AI prompt version',
    table: 'ai_prompt_versions',
    constraint: 'ai_prompt_versions_author_submits',
    draft: async (client, author) => {
      await asUser(client, author);
      const id = randomUUID();
      await client.query(
        `insert into public.ai_prompt_versions (id, feature, system_prompt, output_schema_name, model_config, created_by_user_id)
         values ($1, 'mr_chat', 'BE-C77 probe', 'KnowledgeAnswerSchema', '{"temperature": 0}'::jsonb, $2)`,
        [id, author.id],
      );
      return id;
    },
    submit: 'select public.submit_ai_prompt_version($1)',
    approve: 'select public.approve_ai_prompt_version($1, $2)',
    reject: 'select public.reject_ai_prompt_version($1, $2)',
  },
  {
    name: 'practice persona',
    table: 'sim_personas',
    constraint: 'sim_personas_author_submits',
    draft: async (client, author) => {
      await asUser(client, author);
      const id = randomUUID();
      await client.query(
        `insert into public.sim_personas
           (id, organisation_id, display_name, specialty, stance, brief, created_by_user_id)
         values ($1, $2, 'BE-C77 probe', 'Cardiology', 'rushed', 'A brief.', $3)`,
        [id, world.organisationId, author.id],
      );
      return id;
    },
    submit: `select public.submit_sim_content('persona', $1)`,
    approve: `select public.approve_sim_content('persona', $1, $2)`,
    reject: `select public.reject_sim_content('persona', $1, $2)`,
  },
  {
    name: 'practice scenario',
    table: 'sim_scenarios',
    constraint: 'sim_scenarios_author_submits',
    draft: async (client, author) => {
      await asUser(client, author);
      const personaId = randomUUID();
      const id = randomUUID();
      await client.query(
        `insert into public.sim_personas
           (id, organisation_id, display_name, specialty, stance, brief, created_by_user_id)
         values ($1, $2, 'BE-C77 probe persona', 'Cardiology', 'rushed', 'A brief.', $3)`,
        [personaId, world.organisationId, author.id],
      );
      await client.query(
        `insert into public.sim_scenarios
           (id, organisation_id, persona_id, title, objective, objection, created_by_user_id)
         values ($1, $2, $3, 'BE-C77 probe', 'Explain storage.', 'Too expensive.', $4)`,
        [id, world.organisationId, personaId, author.id],
      );
      return id;
    },
    submit: `select public.submit_sim_content('scenario', $1)`,
    approve: `select public.approve_sim_content('scenario', $1, $2)`,
    reject: `select public.reject_sim_content('scenario', $1, $2)`,
  },
];

/** Read as the database owner, so what is asserted is the row and not what RLS lets a caller see. */
const rowOf = async (client: Client, kind: Kind, id: string) =>
  asOwner(client, async () => {
    const r = await client.query<{
      status: string;
      created_by_user_id: string;
      submitted_by_user_id: string | null;
      decided_by_user_id: string | null;
    }>(
      `select status, created_by_user_id, submitted_by_user_id, decided_by_user_id
         from public.${kind.table} where id = $1`,
      [id],
    );
    return r.rows[0];
  });

describe.skipIf(!reachable)('BE-C77 — the author submits; a different admin decides', () => {
  it('the organisation under test has exactly two admins', async () => {
    await inRolledBackTransaction(async (client) => {
      await makeReviewer(client);
      const n = await asOwner(client, async () =>
        client.query<{ n: number }>(
          `select count(*)::int as n from public.user_profiles
            where role = 'admin' and organisation_id = $1 and is_active`,
          [world.organisationId],
        ),
      );
      expect(n.rows[0]?.n).toBe(2);
    });
  });

  for (const kind of KINDS) {
    describe(kind.name, () => {
      it('two admins complete the workflow: A drafts and submits, B approves', async () => {
        await inRolledBackTransaction(async (client) => {
          const a = world.users.admin;
          const b = await makeReviewer(client);
          const id = await kind.draft(client, a);

          await asUser(client, a);
          expect((await failure(client, kind.submit, [id])).code, 'the author submits').toBeNull();
          await asUser(client, b);
          expect(
            (await failure(client, kind.approve, [id, 'Read in full by the second admin.'])).code,
            'the other admin approves',
          ).toBeNull();

          expect(await rowOf(client, kind, id)).toMatchObject({
            status: 'approved',
            created_by_user_id: a.id,
            submitted_by_user_id: a.id,
            decided_by_user_id: b.id,
          });
        });
      });

      it('the other admin may also reject — a decision either way is not the author’s', async () => {
        await inRolledBackTransaction(async (client) => {
          const a = world.users.admin;
          const b = await makeReviewer(client);
          const id = await kind.draft(client, a);
          await asUser(client, a);
          await client.query(kind.submit, [id]);
          await asUser(client, b);
          expect((await failure(client, kind.reject, [id, 'Not accurate.'])).code).toBeNull();
          expect((await rowOf(client, kind, id))?.status).toBe('rejected');
        });
      });

      it('an admin who did not write the draft cannot submit it', async () => {
        await inRolledBackTransaction(async (client) => {
          const b = await makeReviewer(client);
          const id = await kind.draft(client, world.users.admin);
          await asUser(client, b);
          expect((await failure(client, kind.submit, [id])).code).toBe('42501');
          expect((await rowOf(client, kind, id))?.status, 'still a draft').toBe('draft');
        });
      });

      it('the author cannot approve or reject their own content', async () => {
        await inRolledBackTransaction(async (client) => {
          await makeReviewer(client);
          const a = world.users.admin;
          const id = await kind.draft(client, a);
          await asUser(client, a);
          await client.query(kind.submit, [id]);
          expect((await failure(client, kind.approve, [id, 'I attest.'])).code).toBe('42501');
          expect((await failure(client, kind.reject, [id, 'Changed my mind.'])).code).toBe('42501');
          expect((await rowOf(client, kind, id))?.status, 'still in review').toBe('in_review');
        });
      });

      it('a rep and a manager can neither submit nor decide', async () => {
        await inRolledBackTransaction(async (client) => {
          const a = world.users.admin;
          const draft = await kind.draft(client, a);
          const inReview = await kind.draft(client, a);
          await asUser(client, a);
          await client.query(kind.submit, [inReview]);
          for (const user of [world.users.puneMr, world.users.westManager]) {
            await asUser(client, user);
            expect((await failure(client, kind.submit, [draft])).code, user.role).toBe('42501');
            expect(
              (await failure(client, kind.approve, [inReview, 'I attest.'])).code,
              user.role,
            ).toBe('42501');
          }
          expect((await rowOf(client, kind, draft))?.status).toBe('draft');
          expect((await rowOf(client, kind, inReview))?.status).toBe('in_review');
        });
      });

      it('the table refuses a non-author submitter even from a role that bypasses RLS', async () => {
        await inRolledBackTransaction(async (client) => {
          const b = await makeReviewer(client);
          const id = await kind.draft(client, world.users.admin);
          const write = (submitter: string) =>
            asOwner(client, () =>
              failure(
                client,
                `update public.${kind.table}
                    set status = 'in_review', submitted_at = clock_timestamp(), submitted_by_user_id = $2
                  where id = $1`,
                [id, submitter],
              ),
            );
          // Refused by THIS constraint, not by some other check that happens to share 23514.
          expect(await write(b.id)).toEqual({ code: '23514', constraint: kind.constraint });
          // Positive control: the same write naming the author is accepted.
          expect(await write(world.users.admin.id)).toEqual({ code: null, constraint: null });
        });
      });
    });
  }
});
