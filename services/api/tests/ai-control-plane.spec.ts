import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  AiBeginRequestResponseSchema,
  AiCompleteRequestResponseSchema,
  ApproveAiPromptVersionResponseSchema,
  RejectAiPromptVersionResponseSchema,
  RetireAiPromptVersionResponseSchema,
  SubmitAiPromptVersionResponseSchema,
  refusalForSqlState,
} from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * AI-D0 — the AI control plane (`20260924000700_ai_control_plane.sql`).
 *
 * The property: **no AI call can start unless an admin switched the feature on, a second admin
 * approved the prompt it will use, and a limit is set — and every call that does start is logged,
 * with no conversation in the log.**
 *
 * Every refusal is paired with the same `ai_begin_request` succeeding once the one missing thing
 * is supplied, inside the same rolled-back transaction. Flags and limits are `app_thresholds` rows
 * written as the owner inside that transaction, so no other suite ever sees them.
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

const makeReviewer = async (client: Client): Promise<ProfileLike> => {
  const id = randomUUID();
  await asOwner(client, async () => {
    await client.query(
      `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
      [id, `ai-reviewer-${id.slice(0, 8)}@example.test`],
    );
    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
       values ($1, 'AI Reviewer', 'admin', null, true, $2)`,
      [id, world.organisationId],
    );
  });
  return { id, role: 'admin', territoryId: null, isActive: true };
};

/**
 * A global `app_thresholds` row, visible only inside this transaction.
 *
 * `effectiveFrom` exists because of a property of `threshold()` found by this file: it orders by
 * `effective_from` with no tiebreak, and every row inserted in one transaction defaults to the
 * same `now()`. Two rows for one key in one transaction are therefore ambiguous. Harmless where
 * each change is its own transaction; a trap for a migration that writes a key twice.
 */
const setThreshold = async (
  client: Client,
  key: string,
  value: unknown,
  effectiveFrom = 'now()',
) => {
  await asOwner(client, () =>
    client.query(
      `insert into public.app_thresholds (key, value, scope, note, effective_from)
       values ($1, $2::jsonb, 'global', 'ai-control-plane.spec -- test only, rolled back', ${effectiveFrom})`,
      [key, JSON.stringify(value)],
    ),
  );
};

const draftPrompt = async (
  client: Client,
  feature = 'product_qa',
  text = 'You answer only from approved knowledge.',
) => {
  await asUser(client, world.users.admin);
  const id = randomUUID();
  await client.query(
    `insert into public.ai_prompt_versions (id, feature, system_prompt, output_schema_name, model_config, created_by_user_id)
     values ($1, $2, $3, 'KnowledgeAnswerSchema', '{"temperature": 0}'::jsonb, $4)`,
    [id, feature, text, randomUUID()],
  );
  return id;
};

const approvedPrompt = async (
  client: Client,
  reviewer: ProfileLike,
  feature = 'product_qa',
  text?: string,
) => {
  const id = await draftPrompt(client, feature, text);
  await rpc(client, 'submit_ai_prompt_version', [id]);
  await asUser(client, reviewer);
  await rpc(client, 'approve_ai_prompt_version', [id, 'Reviewed with Medical Affairs.']);
  return id;
};

/** Everything a feature needs to run: flag on, an approved prompt, a limit. */
const ready = async (client: Client, limit = 10) => {
  const reviewer = await makeReviewer(client);
  await setThreshold(client, 'ai_feature_enabled:product_qa', true);
  await setThreshold(client, 'ai_daily_requests_per_user', limit);
  const promptId = await approvedPrompt(client, reviewer);
  return { reviewer, promptId };
};

const begin = async (client: Client, user: FixtureUser | ProfileLike, feature = 'product_qa') => {
  await asUser(client, user);
  return sqlstate(client, 'select public.ai_begin_request($1)', [feature]);
};

describe.skipIf(!reachable)(
  'AI-D0 — nothing starts unless it was switched on, approved and limited',
  () => {
    it('every feature is off out of the box, and the refusal maps to ai_feature_disabled', async () => {
      await inRolledBackTransaction(async (client) => {
        expect(await begin(client, world.users.puneMr)).toBe('45011');
        expect(refusalForSqlState('45011')).toMatchObject({
          code: 'ai_feature_disabled',
          actionable: false,
        });
        await ready(client);
        expect(await begin(client, world.users.puneMr), 'positive control').toBeNull();
      });
    });

    it('each missing prerequisite alone refuses: the flag, the approved prompt, the limit', async () => {
      await inRolledBackTransaction(async (client) => {
        const reviewer = await makeReviewer(client);
        await setThreshold(client, 'ai_daily_requests_per_user', 10);
        await approvedPrompt(client, reviewer);
        expect(await begin(client, world.users.puneMr), 'no flag').toBe('45011');
        await setThreshold(
          client,
          'ai_feature_enabled:product_qa',
          false,
          "now() - interval '1 minute'",
        );
        expect(await begin(client, world.users.puneMr), 'flag false').toBe('45011');
        await setThreshold(client, 'ai_feature_enabled:product_qa', true);
        expect(await begin(client, world.users.puneMr), 'all three present').toBeNull();
      });

      await inRolledBackTransaction(async (client) => {
        await setThreshold(client, 'ai_feature_enabled:product_qa', true);
        await setThreshold(client, 'ai_daily_requests_per_user', 10);
        const inReview = await draftPrompt(client);
        await rpc(client, 'submit_ai_prompt_version', [inReview]);
        expect(await begin(client, world.users.puneMr), 'a prompt in review is not approved').toBe(
          '45011',
        );
      });

      await inRolledBackTransaction(async (client) => {
        const reviewer = await makeReviewer(client);
        await setThreshold(client, 'ai_feature_enabled:product_qa', true);
        await approvedPrompt(client, reviewer);
        expect(
          await begin(client, world.users.puneMr),
          'no limit: never unlimited by default',
        ).toBe('45011');
      });
    });

    it('a switched-on feature for one feature does not switch on another', async () => {
      await inRolledBackTransaction(async (client) => {
        await ready(client);
        expect(await begin(client, world.users.puneMr, 'ai_doctor')).toBe('45011');
      });
    });

    it('another organisation’s approved prompt is not yours', async () => {
      await inRolledBackTransaction(async (client) => {
        await ready(client);
        expect(await begin(client, world.users.rivalMr)).toBe('45011');
      });
    });

    it('the daily allowance is counted at the start, per person, and refuses with ai_rate_limited', async () => {
      await inRolledBackTransaction(async (client) => {
        await ready(client, 2);
        expect(await begin(client, world.users.puneMr)).toBeNull();
        expect(await begin(client, world.users.puneMr)).toBeNull();
        expect(await begin(client, world.users.puneMr), 'third of two').toBe('45012');
        expect(refusalForSqlState('45012')).toMatchObject({
          code: 'ai_rate_limited',
          actionable: true,
        });
        expect(await begin(client, world.users.nagpurMr), 'someone else is unaffected').toBeNull();
      });
    });
  },
);

describe.skipIf(!reachable)('AI-D0 — prompts are approved like knowledge', () => {
  it('four eyes, an attestation, and approval retires the previous prompt', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      const v1 = await draftPrompt(client);
      await rpc(client, 'submit_ai_prompt_version', [v1]);
      expect(
        await sqlstate(client, 'select public.approve_ai_prompt_version($1, $2)', [v1, 'Mine.']),
        'the author',
      ).toBe('42501');
      await asUser(client, reviewer);
      expect(
        await sqlstate(client, 'select public.approve_ai_prompt_version($1, $2)', [v1, ' ']),
        'no attestation',
      ).toBe('22023');
      await rpc(client, 'approve_ai_prompt_version', [v1, 'Reviewed.']);

      const v2 = await draftPrompt(client, 'product_qa', 'Second wording.');
      await rpc(client, 'submit_ai_prompt_version', [v2]);
      await asUser(client, reviewer);
      const out = await rpc<{ retiredPromptVersionIds: string[] }>(
        client,
        'approve_ai_prompt_version',
        [v2, 'Replaces v1.'],
      );
      expect(out.retiredPromptVersionIds).toEqual([v1]);

      await setThreshold(client, 'ai_feature_enabled:product_qa', true);
      await setThreshold(client, 'ai_daily_requests_per_user', 10);
      await asUser(client, world.users.puneMr);
      const started = await rpc<{ promptVersionId: string; systemPrompt: string }>(
        client,
        'ai_begin_request',
        ['product_qa'],
      );
      expect(started).toMatchObject({ promptVersionId: v2, systemPrompt: 'Second wording.' });
    });
  });

  it('a submitted prompt is frozen, and its status moves only through the RPCs', async () => {
    await inRolledBackTransaction(async (client) => {
      const id = await draftPrompt(client);
      expect(
        await sqlstate(
          client,
          `update public.ai_prompt_versions set system_prompt = 'Edited.' where id = $1`,
          [id],
        ),
        'a draft is editable',
      ).toBeNull();
      await rpc(client, 'submit_ai_prompt_version', [id]);
      expect(
        await sqlstate(
          client,
          `update public.ai_prompt_versions set system_prompt = 'Late.' where id = $1`,
          [id],
        ),
      ).toBe('23514');
      expect(
        await sqlstate(
          client,
          `update public.ai_prompt_versions set status = 'approved' where id = $1`,
          [id],
        ),
      ).toBe('42501');
    });
  });

  it('an MR or manager can neither read nor write a prompt', async () => {
    await inRolledBackTransaction(async (client) => {
      const id = await draftPrompt(client);
      for (const user of [world.users.puneMr, world.users.westManager]) {
        await asUser(client, user);
        const seen = await client.query(`select 1 from public.ai_prompt_versions where id = $1`, [
          id,
        ]);
        expect(seen.rowCount, `${user.role} reads`).toBe(0);
        expect(
          await sqlstate(
            client,
            `insert into public.ai_prompt_versions (feature, system_prompt, created_by_user_id) values ('mr_chat', 'x', $1)`,
            [user.id],
          ),
          `${user.role} writes`,
        ).toBe('42501');
      }
      await asUser(client, world.users.admin);
      const own = await client.query(`select 1 from public.ai_prompt_versions where id = $1`, [id]);
      expect(own.rowCount, 'positive control: the admin reads it').toBe(1);
    });
  });
});

describe.skipIf(!reachable)('AI-D0 — completing a request', () => {
  it('only the user it belongs to, only once, never back to started', async () => {
    await inRolledBackTransaction(async (client) => {
      await ready(client);
      await asUser(client, world.users.puneMr);
      const { requestId } = await rpc<{ requestId: string }>(client, 'ai_begin_request', [
        'product_qa',
      ]);
      const complete = (status = 'completed') =>
        sqlstate(
          client,
          `select public.ai_complete_request($1, $2::public.ai_request_status, 'provider', 'model', 10, 20)`,
          [requestId, status],
        );

      await asUser(client, world.users.nagpurMr);
      expect(await complete(), 'someone else').toBe('42501');
      await asUser(client, world.users.puneMr);
      expect(await complete('started'), 'back to started').toBe('22023');
      expect(await complete(), 'the owner').toBeNull();
      expect(await complete(), 'twice').toBe('22023');
    });
  });

  it('a source must be an approved knowledge version of the organisation', async () => {
    await inRolledBackTransaction(async (client) => {
      const { reviewer } = await ready(client);
      await asUser(client, world.users.admin);
      const doc = randomUUID();
      await client.query(
        `insert into public.knowledge_documents (id, title, document_type) values ($1, 'Source', 'faq')`,
        [doc],
      );
      const [draft, approved] = [randomUUID(), randomUUID()];
      for (const id of [draft, approved]) {
        await client.query(
          `insert into public.knowledge_document_versions
             (id, document_id, body, source_reference, effective_from, created_by_user_id)
           values ($1, $2, 'Source text.', 'test', '2026-01-01', $3)`,
          [id, doc, world.users.admin.id],
        );
      }
      await rpc(client, 'submit_knowledge_version', [approved]);
      await asUser(client, reviewer);
      await rpc(client, 'approve_knowledge_version', [approved, 'Reviewed.']);

      await asUser(client, world.users.puneMr);
      const a = await rpc<{ requestId: string }>(client, 'ai_begin_request', ['product_qa']);
      const b = await rpc<{ requestId: string }>(client, 'ai_begin_request', ['product_qa']);
      const withSources = (requestId: string, ids: string[]) =>
        sqlstate(
          client,
          `select public.ai_complete_request($1, 'completed', 'p', 'm', 1, 1, $2::uuid[])`,
          [requestId, ids],
        );
      expect(await withSources(a.requestId, [draft]), 'a draft is not a source').toBe('22023');
      expect(await withSources(a.requestId, [randomUUID()]), 'nothing is not a source').toBe(
        '22023',
      );
      expect(await withSources(b.requestId, [approved]), 'an approved version is').toBeNull();
    });
  });

  it('flags are a closed vocabulary, and latency is measured by the server', async () => {
    await inRolledBackTransaction(async (client) => {
      await ready(client);
      await asUser(client, world.users.puneMr);
      const a = await rpc<{ requestId: string }>(client, 'ai_begin_request', ['product_qa']);
      expect(
        await sqlstate(
          client,
          `select public.ai_complete_request($1, 'blocked', 'p', 'm', 1, 1, '{}', array['severity_high'])`,
          [a.requestId],
        ),
        'an invented flag',
      ).toBe('23514');
      const out = await rpc<{ latencyMs: number; flags: string[] }>(client, 'ai_complete_request', [
        a.requestId,
        'blocked',
        'p',
        'm',
        1,
        1,
        [],
        ['possible_adverse_event', 'knowledge_not_available', 'possible_adverse_event'],
      ]);
      expect(out.latencyMs).toBeGreaterThanOrEqual(0);
      expect(out.flags, 'deduplicated and ordered').toEqual([
        'knowledge_not_available',
        'possible_adverse_event',
      ]);
    });
  });
});

describe.skipIf(!reachable)('AI-D0 — the log', () => {
  it('is read by the user and their admin — not a peer, not a manager, not another company', async () => {
    await inRolledBackTransaction(async (client) => {
      await ready(client);
      await asUser(client, world.users.puneMr);
      const { requestId } = await rpc<{ requestId: string }>(client, 'ai_begin_request', [
        'product_qa',
      ]);
      const cases: [FixtureUser, number][] = [
        [world.users.puneMr, 1],
        [world.users.admin, 1],
        [world.users.nagpurMr, 0],
        [world.users.westManager, 0],
        [world.users.rivalAdmin, 0],
      ];
      for (const [user, expected] of cases) {
        await asUser(client, user);
        const r = await client.query(`select 1 from public.ai_requests where id = $1`, [requestId]);
        expect(r.rowCount, `${user.role} ${user.id.slice(0, 8)}`).toBe(expected);
      }
    });
  });

  it('is written only through the RPCs, and never deleted', async () => {
    await inRolledBackTransaction(async (client) => {
      const { promptId } = await ready(client);
      await asUser(client, world.users.puneMr);
      expect(
        await sqlstate(
          client,
          `insert into public.ai_requests (organisation_id, user_id, feature, prompt_version_id)
           values ($1, $2, 'product_qa', $3)`,
          [world.organisationId, world.users.puneMr.id, promptId],
        ),
      ).toBe('42501');
      const { requestId } = await rpc<{ requestId: string }>(client, 'ai_begin_request', [
        'product_qa',
      ]);
      const code = await asOwner(client, () =>
        sqlstate(client, `delete from public.ai_requests where id = $1`, [requestId]),
      );
      expect(code).toBe('23001');
    });
  });

  it('has no column that could hold a conversation (§52)', async () => {
    await inRolledBackTransaction(async (client) => {
      const r = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'ai_requests'
            and column_name ~ '(prompt_text|message|content|answer|question|response|output_text|input_text|transcript|payload|body)'`,
      );
      expect(r.rows).toEqual([]);
    });
  });
});

describe.skipIf(!reachable)('AI-D0 — every RPC response matches @fieldforce/core', () => {
  it('prompt lifecycle, begin and complete', async () => {
    await inRolledBackTransaction(async (client) => {
      const reviewer = await makeReviewer(client);
      const a = await draftPrompt(client);
      SubmitAiPromptVersionResponseSchema.parse(await rpc(client, 'submit_ai_prompt_version', [a]));
      await asUser(client, reviewer);
      ApproveAiPromptVersionResponseSchema.parse(
        await rpc(client, 'approve_ai_prompt_version', [a, 'Reviewed.']),
      );

      const b = await draftPrompt(client, 'mr_chat');
      await rpc(client, 'submit_ai_prompt_version', [b]);
      await asUser(client, reviewer);
      RejectAiPromptVersionResponseSchema.parse(
        await rpc(client, 'reject_ai_prompt_version', [b, 'Too broad.']),
      );

      await setThreshold(client, 'ai_feature_enabled:product_qa', true);
      await setThreshold(client, 'ai_daily_requests_per_user', 10);
      await asUser(client, world.users.puneMr);
      const started = AiBeginRequestResponseSchema.parse(
        await rpc(client, 'ai_begin_request', ['product_qa']),
      );
      AiCompleteRequestResponseSchema.parse(
        await rpc(client, 'ai_complete_request', [started.requestId, 'completed', 'p', 'm', 5, 7]),
      );

      await asUser(client, world.users.admin);
      RetireAiPromptVersionResponseSchema.parse(await rpc(client, 'retire_ai_prompt_version', [a]));
    });
  });
});
