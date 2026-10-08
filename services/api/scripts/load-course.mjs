#!/usr/bin/env node
/**
 * W2-H A1 — the course loader: a Markdown file in, a DRAFT course version out, which an admin then
 * publishes. Copy `docs/operator/course-template.md`.
 *
 * **The shape, from `20260924000500_lms_core.sql`.** A course is a name; its content is a VERSION
 * (draft → published → retired, frozen once published), optionally for one market and one product;
 * a version holds MODULES in order, a module holds LESSONS in order, each with a title, a body and
 * optional minutes. Positions are 1, 2, 3… — taken from the order in the file, never typed.
 * `publish_course_version` refuses a version with no lessons. A course that already exists (same
 * title, same company) gets a NEW draft version, so published history is never touched.
 *
 *   ---
 *   course: Storage basics
 *   market: India              (a market of your company by name, or: any)
 *   product: Benchmarol        (optional; a product by brand or generic name)
 *   summary: One line.         (optional)
 *   ---
 *   ## Keeping stock           (a module)
 *   ### Cold chain             (a lesson in it)
 *   minutes: 5                 (optional, the line right after the lesson title)
 *   The lesson text…
 *
 * **What it refuses, by line, before anything is written** (`checkCourse`, then the catalogue):
 *   missing_header / bad_header_line   the --- block is absent, unclosed, or has a non "key: value" line
 *   missing_field                      no `course:` or no `market:` (say `any` for every market — never by omission)
 *   example_content                    the course title starts EXAMPLE: the template's own example, left in
 *   stray_text                         text before the first module
 *   lesson_before_module               a ### lesson before any ## module
 *   empty_title                        a ## or ### with no title
 *   module_without_lessons             a module with no lesson (a version without lessons cannot be published)
 *   no_modules                         no module at all
 *   empty_lesson                       a lesson with no text
 *   bad_minutes                        minutes that are not a whole number above 0
 *   duplicate_lesson                   two lessons with the same title in one module
 * and, signed in: not_admin, unknown_market, unknown_product, ambiguous_name, draft_already_open (the
 * course already has a draft WITH content — publish it first; an EMPTY draft, left by a failed load, is reused).
 *
 * **It never publishes.** Publishing is the admin's act, in the console or with the RPC; the loader
 * stops at a draft, and says which version it made.
 *
 *   node services/api/scripts/load-course.mjs <file.md>                    check only, offline
 *   LOADER_PASSWORD=… node services/api/scripts/load-course.mjs <file.md> --write \
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

/**
 * Parse and check a course file. Pure: every refusal, by line. No network.
 * @param {string} text
 */
export const checkCourse = (text) => {
  const { header, body, bodyStartLine, problems } = splitHeader(text);
  const course = {
    title: header.course?.value ?? '',
    market: header.market?.value ?? '',
    product: header.product?.value ?? '',
    summary: header.summary?.value ?? '',
    modules: [],
  };
  if (problems.some((p) => p.code === 'missing_header')) return { course, problems };
  if (course.title === '')
    problems.push({ code: 'missing_field', line: 1, detail: 'no "course:" in the header' });
  if (course.market === '') {
    problems.push({
      code: 'missing_field',
      line: 1,
      detail: 'no "market:" in the header — name a market, or write "any"',
    });
  }
  if (course.title !== '' && isExample(course.title)) {
    problems.push({
      code: 'example_content',
      line: header.course.line,
      detail: `"${course.title}" is the template's example — write your own course, or remove EXAMPLE from the title once it is real`,
    });
  }

  const lines = body.split('\n');
  let module = null;
  let lesson = null;
  const close = () => {
    if (lesson !== null) {
      lesson.body = lesson.body.join('\n').trim();
      if (lesson.body === '' && lesson.orphan !== true)
        problems.push({
          code: 'empty_lesson',
          line: lesson.line,
          detail: `"${lesson.title}" has no text`,
        });
      lesson = null;
    }
  };
  lines.forEach((raw, i) => {
    const line = bodyStartLine + i;
    const m2 = /^##\s+(.*)$/u.exec(raw);
    const m3 = /^###\s+(.*)$/u.exec(raw);
    if (m3 !== null) {
      close();
      const title = (m3[1] ?? '').trim();
      if (title === '')
        problems.push({ code: 'empty_title', line, detail: 'a ### lesson has no title' });
      if (module === null) {
        problems.push({
          code: 'lesson_before_module',
          line,
          detail: `"${title}" comes before any ## module`,
        });
        // Held, attached to nothing, so its text is not reported a second time as stray.
        lesson = { title, minutes: null, body: [], line, minutesChecked: false, orphan: true };
        return;
      }
      if (module.lessons.some((l) => l.title.toLowerCase() === title.toLowerCase())) {
        problems.push({
          code: 'duplicate_lesson',
          line,
          detail: `"${title}" appears twice in "${module.title}"`,
        });
      }
      lesson = { title, minutes: null, body: [], line, minutesChecked: false };
      module.lessons.push(lesson);
      return;
    }
    if (m2 !== null) {
      close();
      const title = (m2[1] ?? '').trim();
      if (title === '')
        problems.push({ code: 'empty_title', line, detail: 'a ## module has no title' });
      module = { title, lessons: [], line };
      course.modules.push(module);
      return;
    }
    if (lesson !== null) {
      const minutes = /^minutes:\s*(.*)$/u.exec(raw.trim());
      if (!lesson.minutesChecked && lesson.body.every((b) => b.trim() === '') && minutes !== null) {
        lesson.minutesChecked = true;
        const n = Number(minutes[1]);
        if (!Number.isInteger(n) || n <= 0) {
          problems.push({
            code: 'bad_minutes',
            line,
            detail: `"${String(minutes[1])}" is not a whole number of minutes above 0`,
          });
        } else {
          lesson.minutes = n;
        }
        return;
      }
      lesson.body.push(raw);
      return;
    }
    if (raw.trim() !== '') {
      problems.push({
        code: 'stray_text',
        line,
        detail:
          module === null
            ? 'text before the first ## module'
            : `text in "${module.title}" before its first ### lesson`,
      });
    }
  });
  close();

  if (course.modules.length === 0)
    problems.push({
      code: 'no_modules',
      line: bodyStartLine,
      detail: 'the course has no ## module',
    });
  for (const m of course.modules) {
    if (m.lessons.length === 0) {
      problems.push({
        code: 'module_without_lessons',
        line: m.line,
        detail: `"${m.title}" has no ### lesson — a version without lessons cannot be published`,
      });
    }
  }
  for (const m of course.modules) for (const l of m.lessons) delete l.minutesChecked;
  return { course, problems };
};

/**
 * Check against the company, then write the draft. Throws on any refusal; writes NOTHING unless
 * every check passed. On a failure part-way, removes what it wrote (all of it draft, never seen by a rep).
 */
export const loadCourse = async (course, { url, apiKey, email, password, fetchImpl }) => {
  const session = await signIn({ url, apiKey, email, password, fetchImpl });
  const rest = restClient({ url, apiKey, token: session.token, fetchImpl });
  const problems = [];
  const me = await whoAmI(rest, session.userId);
  if (me?.role !== 'admin')
    problems.push({
      code: 'not_admin',
      line: 1,
      detail: `${email} is not an admin of a company — only an admin writes courses`,
    });

  let marketId = null;
  if (course.market.toLowerCase() !== 'any') {
    const market = await byName(rest, 'markets', course.market);
    if (market === null)
      problems.push({
        code: 'unknown_market',
        line: 1,
        detail: `your company has no market called "${course.market}"`,
      });
    else if (market === 'ambiguous')
      problems.push({
        code: 'ambiguous_name',
        line: 1,
        detail: `more than one market is called "${course.market}"`,
      });
    else marketId = market.id;
  }
  let productId = null;
  if (course.product !== '') {
    const product = await byName(rest, 'products', course.product);
    if (product === null)
      problems.push({
        code: 'unknown_product',
        line: 1,
        detail: `your company has no product called "${course.product}"`,
      });
    else if (product === 'ambiguous')
      problems.push({
        code: 'ambiguous_name',
        line: 1,
        detail: `more than one product is called "${course.product}"`,
      });
    else productId = product.id;
  }
  const existing = (await rest.get(`courses?select=id,title`)).find(
    (c) => String(c.title).trim().toLowerCase() === course.title.trim().toLowerCase(),
  );
  // `BE-W167` — an open draft with NO modules is what a load that failed part-way leaves (its version cannot be
  // deleted, retired or published), so it is reused. A draft with content is someone's work: refused.
  let emptyDraft = null;
  if (existing !== undefined) {
    const drafts = await rest.get(
      `course_versions?select=id,version_number,course_modules(id)&course_id=eq.${existing.id}&status=eq.draft`,
    );
    if (drafts.length > 0 && drafts[0].course_modules.length === 0) {
      emptyDraft = drafts[0];
    } else if (drafts.length > 0) {
      problems.push({
        code: 'draft_already_open',
        line: 1,
        detail: `"${course.title}" already has draft version ${String(drafts[0].version_number)} — publish or discard it first`,
      });
    }
  }
  if (problems.length > 0) {
    const error = new Error(`NOTHING WRITTEN. Refused:\n${formatProblems(problems)}`);
    error.problems = problems;
    throw error;
  }

  const written = [];
  try {
    const courseId = existing?.id ?? (await rest.insert('courses', { title: course.title })).id;
    if (existing === undefined) written.push(`courses?id=eq.${courseId}`);
    // organisation_id is derived from the course by the database's trigger; the value sent is ignored.
    const fields = {
      title: course.title,
      summary: course.summary === '' ? null : course.summary,
      market_id: marketId,
      product_id: productId,
    };
    const version =
      emptyDraft === null
        ? await rest.insert('course_versions', {
            course_id: courseId,
            organisation_id: me.organisation_id,
            ...fields,
          })
        : await rest.update(`course_versions?id=eq.${emptyDraft.id}`, fields);
    for (const [mi, m] of course.modules.entries()) {
      const mod = await rest.insert('course_modules', {
        course_version_id: version.id,
        organisation_id: me.organisation_id,
        position: mi + 1,
        title: m.title,
      });
      written.unshift(`course_modules?id=eq.${mod.id}`);
      for (const [li, l] of m.lessons.entries()) {
        const lesson = await rest.insert('lessons', {
          module_id: mod.id,
          course_version_id: version.id,
          organisation_id: me.organisation_id,
          position: li + 1,
          title: l.title,
          body: l.body,
          estimated_minutes: l.minutes,
        });
        written.unshift(`lessons?id=eq.${lesson.id}`);
      }
    }
    // Read back what the server holds, under the same admin: it must be a draft.
    const [held] = await rest.get(
      `course_versions?select=id,version_number,status&id=eq.${version.id}`,
    );
    if (held?.status !== 'draft')
      throw new Error(`the version came back "${String(held?.status)}", not draft`);
    return {
      courseId,
      versionId: version.id,
      versionNumber: held.version_number,
      modules: course.modules.length,
      lessons: course.modules.reduce((n, m) => n + m.lessons.length, 0),
    };
  } catch (error) {
    // Draft rows only; an admin may delete them (the grants allow it on a draft's modules and lessons).
    for (const path of written) {
      try {
        await rest.remove(path);
      } catch {
        // Left in place; the message below says the load failed.
      }
    }
    // The course and its version cannot be deleted (no grant allows it), so an empty DRAFT version may
    // remain. It is invisible to reps, and a re-run fills it (W2-H D: it used to lock the course).
    throw new Error(
      `LOAD FAILED part-way: ${error instanceof Error ? error.message : String(error)}. Its modules and lessons were removed; an empty draft version may remain (reps never see a draft); run the load again and it is reused.`,
    );
  }
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
      'usage: load-course.mjs <file.md> [--write --url <url> --key <publishable key> --email <admin>]',
    );
    process.exit(2);
  }
  const { course, problems } = checkCourse(readFileSync(file, 'utf8'));
  if (problems.length > 0) {
    console.error(
      `NOTHING WRITTEN. ${file} has ${String(problems.length)} problem(s):\n${formatProblems(problems)}`,
    );
    process.exit(1);
  }
  const lessons = course.modules.reduce((n, m) => n + m.lessons.length, 0);
  if (!args.includes('--write')) {
    console.log(
      `${file} is loadable: "${course.title}", ${String(course.modules.length)} module(s), ${String(lessons)} lesson(s). Nothing written (no --write).`,
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
    const out = await loadCourse(course, {
      url: opt('--url'),
      apiKey: opt('--key'),
      email: opt('--email'),
      password,
    });
    console.log(
      `DRAFT written: "${course.title}" version ${String(out.versionNumber)}, ${String(out.modules)} module(s), ${String(out.lessons)} lesson(s). Publish it in the console when it has been read.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
