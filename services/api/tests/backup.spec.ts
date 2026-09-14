import { describe, expect, it } from 'vitest';
import {
  compareCounts,
  MANIFEST_TABLES,
  pgDumpCommand,
  resolveTarget,
} from '../scripts/backup-database.mjs';
import { checkDigest } from '../scripts/verify-backup.mjs';

/**
 * `BE-W11` — the parts of the backup path that can be asserted without a database.
 *
 * The end-to-end proof is a restore, not a test: MR-33 B4 produced a 17 MB artefact, restored
 * it into a scratch database and compared 56 migrations, 36 tables, 36 RLS tables, 48 policies
 * and five row counts against a manifest written when the dump was taken. Two failure controls
 * ran beside it — a truncated artefact caught by the hash, and an intact artefact with a wrong
 * count caught only by the query.
 */
describe('BE-W11 — the backup path', () => {
  describe('resolveTarget — a dump is a data-processing act', () => {
    it('refuses a non-local SUPABASE_DB_URL that was not named on the command line', () => {
      // The dump contains doctors' names, user profiles, adverse-event report text and every
      // auth identity. It must not be produced because a variable was left set.
      expect(() =>
        resolveTarget({
          envUrl: 'postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
        }),
      ).toThrow(/refuses a non-local target/u);
    });

    it('allows the local stack, which is the ordinary case', () => {
      expect(
        resolveTarget({ envUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }),
      ).toContain('127.0.0.1');
    });

    it('allows a remote target when it IS named, because then somebody meant it', () => {
      const named = 'postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
      expect(resolveTarget({ dbUrlFlag: named, envUrl: 'postgresql://x@127.0.0.1:5432/y' })).toBe(
        named,
      );
    });
  });

  describe('compareCounts — what makes a restore believable', () => {
    const base = {
      migrations: 56,
      tables: 36,
      rlsTables: 36,
      policies: 48,
      rows: { 'public.consent_records': 1910, 'auth.users': 5447 },
    };

    it('is ok when everything matches', () => {
      expect(compareCounts(base, { ...base }).ok).toBe(true);
    });

    it('catches a lost table even when every row count matches', () => {
      const restored = { ...base, tables: 35 };
      const verdict = compareCounts(base, restored);
      expect(verdict.ok).toBe(false);
      expect(verdict.differences).toContain('tables: source 36, restored 35');
    });

    it('catches RLS silently not coming back, which a row count cannot see', () => {
      // A restore that brings every row and no policy is the worst kind of success.
      const verdict = compareCounts(base, { ...base, rlsTables: 0, policies: 0 });
      expect(verdict.ok).toBe(false);
      expect(verdict.differences).toContain('rlsTables: source 36, restored 0');
      expect(verdict.differences).toContain('policies: source 48, restored 0');
    });

    it('catches a single missing row in the consent ledger', () => {
      const verdict = compareCounts(base, {
        ...base,
        rows: { ...base.rows, 'public.consent_records': 1909 },
      });
      expect(verdict.differences).toContain('public.consent_records: source 1910, restored 1909');
    });

    it('names auth.users, because a restore without it is a database nobody can sign into', () => {
      expect(MANIFEST_TABLES).toContain('auth.users');
      const verdict = compareCounts(base, { ...base, rows: { ...base.rows, 'auth.users': 0 } });
      expect(verdict.differences).toContain('auth.users: source 5447, restored 0');
    });
  });

  describe('pgDumpCommand', () => {
    it('dumps the whole database, not one schema', () => {
      // `supabase db dump` is scoped to `public` and omits auth and storage entirely; a
      // database restored from it has nobody who can sign in. Measured in MR-33 B1.
      const plan = pgDumpCommand({
        dbUrl: 'postgresql://u:p@h:5432/postgres',
        sqlPath: '/tmp/x.sql',
      });
      expect(plan.command).toBe('pg_dump');
      expect(plan.args).not.toContain('--schema');
      expect(plan.args).not.toContain('--data-only');
    });

    it('inside a container, connects over the socket rather than the published port', () => {
      // The host URL names 54322; the container's own localhost has Postgres on 5432, and
      // passing the host URL through `docker exec` gave "Connection refused".
      const plan = pgDumpCommand({
        dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        sqlPath: 'C:/somewhere/x.sql',
        container: 'supabase_db_Elmiron-App',
      });
      expect(plan.command).toBe('docker');
      expect(plan.args.join(' ')).not.toContain('54322');
      expect(plan.args).toContain('-U');
      expect(plan.copyOut?.container).toBe('supabase_db_Elmiron-App');
    });
  });

  describe('checkDigest', () => {
    it('catches a truncated artefact', () => {
      const full = Buffer.from('the whole dump');
      const partial = Buffer.from('the whole');
      const { ok } = checkDigest(partial, checkDigest(full, '').actual);
      expect(ok).toBe(false);
    });

    it('THE POSITIVE CONTROL: an intact artefact matches', () => {
      const bytes = Buffer.from('the whole dump');
      expect(checkDigest(bytes, checkDigest(bytes, '').actual).ok).toBe(true);
    });
  });
});
