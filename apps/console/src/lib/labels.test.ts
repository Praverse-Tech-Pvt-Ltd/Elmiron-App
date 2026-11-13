import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_READ_REASON_KEYS,
  actionLabel,
  auditWhat,
  contentKindLabel,
  featureLabel,
  reasonLabel,
  roleWord,
  stanceLabel,
  tableLabel,
  timeZoneLabel,
  whoLabel,
  words,
} from './labels';

describe('FE-W165 — stored values read as words', () => {
  it('names the audit trail’s rows the same way everywhere', () => {
    expect(auditWhat('insert', 'ai_requests')).toBe('Created · AI request');
    expect(auditWhat('select', 'consent_records')).toBe('Read · Consent record');
    expect(actionLabel('update')).toBe('Changed');
    expect(tableLabel('user_profiles')).toBe('User');
  });

  it('turns a table nobody has named yet into words, never snake_case', () => {
    expect(tableLabel('restore_reconciliation_findings')).toBe('Restore reconciliation findings');
    expect(tableLabel('sim_whatever')).toBe('Practice whatever');
    expect(words('objection_handling')).toBe('Objection handling');
  });

  it('names roles as people do, and does not repeat one a name already carries', () => {
    expect(roleWord('mr')).toBe('Rep');
    expect(roleWord('field_manager')).toBe('Manager');
    expect(roleWord(null)).toBeNull();
    expect(whoLabel('Rep 1 (Pune)', 'mr')).toBe('Rep 1 (Pune)');
    expect(whoLabel('Asha Patil', 'admin')).toBe('Asha Patil · Admin');
    expect(whoLabel(null, 'admin')).toBe('Admin');
    expect(whoLabel(null, null)).toBe('Not recorded');
  });

  it('shows the screen that was opened in place of the console’s own read reason', () => {
    expect(reasonLabel('console admin screen — compliance panel render')).toBe(
      'Opened Consent versions',
    );
    // A reason a person typed is theirs, verbatim.
    expect(reasonLabel('quarterly compliance review')).toBe('quarterly compliance review');
    expect(reasonLabel(null)).toBeNull();
    expect(reasonLabel('  ')).toBeNull();
  });

  it('uses the field app’s names for the AI features', () => {
    expect(
      ['product_qa', 'mr_chat', 'lms_tutor', 'ai_doctor', 'ai_coach'].map(featureLabel),
    ).toEqual([
      'Product questions',
      'Assistant',
      'Lesson tutor',
      'AI Doctor practice',
      'Practice feedback',
    ]);
  });

  it('names practice values and the time zone', () => {
    expect(stanceLabel('sceptical')).toBe('Sceptical');
    expect(stanceLabel('rushed')).toBe('In a hurry');
    expect(contentKindLabel('persona')).toBe('Practice doctor');
    expect(contentKindLabel('scenario')).toBe('Scenario');
    expect(timeZoneLabel('Asia/Kolkata')).toBe('India time (IST)');
    expect(timeZoneLabel('Asia/Dubai')).toBe('Asia/Dubai');
  });
});

/** Every `.ts`/`.tsx` source under `src`, tests excluded — found, not listed. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry) ? [full] : [];
  });

describe('FE-W165 — every reason the console sends has a label', () => {
  const sent = sources(SRC).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/READ_REASON\s*=\s*'([^']+)'/gu)].map((m) => m[1]),
  );

  it('found the reasons it is about to check', () => {
    // The precondition: a moved directory must not make this pass against nothing.
    expect(sent.length).toBeGreaterThanOrEqual(5);
  });

  it('names each one, so no screen’s reason reaches a person as an engineer’s string', () => {
    expect(sent.filter((reason) => !CONSOLE_READ_REASON_KEYS.includes(reason ?? ''))).toEqual([]);
  });
});
