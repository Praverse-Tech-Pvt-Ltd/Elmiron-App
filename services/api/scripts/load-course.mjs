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
 *   Video: clips/cold-chain.mp4 (optional, `BE-W210`: a clip made by `pnpm video:trim`, relative to this file)
 *   Poster: clips/cold-chain.jpg (optional, only with a Video: line)
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
 *   duplicate_line                     a second minutes:, Video: or Poster: line under one lesson
 *   bad_video / bad_poster             a Video: that is not .mp4, a Poster: that is not .jpg
 *   poster_without_video               a Poster: line with no Video: line
 * then the clip files themselves (`checkCourseMedia`, offline too): video_missing / poster_missing,
 * video_too_large / poster_too_large (over 50 MiB, the bucket's limit), and — when `ffprobe` is on PATH —
 * video_not_playable (not H.264 / yuv420p / AAC, or above 720p: make it with `pnpm video:trim`).
 * and, signed in: not_admin, unknown_market, unknown_product, ambiguous_name, draft_already_open (the
 * course already has a draft WITH content — publish it first; an EMPTY draft, left by a failed load, is reused).
 *
 * **Videos (`BE-W210`).** With `--write`, each clip and poster is uploaded AS THE SIGNED-IN ADMIN to
 * `lesson-videos/<organisation>/<draft version>/<lesson>/video-<hash>.mp4` — the storage policy admits
 * only an admin, only into a DRAFT of their own company (`20261014000100_lesson_videos.sql`) — and the
 * lesson's `video_*` columns are set to it. The file name is the content's hash, so an upload that is
 * repeated after a failure finds its own object and carries on. A clip cannot be deleted or replaced
 * through the API, by anyone: a load that fails part-way leaves its clips in the draft's folder, where no
 * rep can read them (a non-admin reads only what a lesson names).
 *
 * **It never publishes.** Publishing is the admin's act — `content-step.mjs publish-course` (no screen does it, `BE-W168`); the loader
 * stops at a draft, and says which version it made.
 *
 *   node services/api/scripts/load-course.mjs <file.md>                    check only, offline
 *   LOADER_PASSWORD=… node services/api/scripts/load-course.mjs <file.md> --write \
 *     --url http://127.0.0.1:54321 --key <publishable key> --email admin@company
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  byName,
  formatProblems,
  isExample,
  restClient,
  signIn,
  splitHeader,
  whoAmI,
} from './content-loader.mjs';
import { LIMIT_BYTES, findTool, playabilityProblems, probeFile } from './trim-video.mjs';

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
        lesson = {
          title,
          minutes: null,
          video: null,
          poster: null,
          body: [],
          line,
          seen: new Set(),
          orphan: true,
        };
        return;
      }
      if (module.lessons.some((l) => l.title.toLowerCase() === title.toLowerCase())) {
        problems.push({
          code: 'duplicate_lesson',
          line,
          detail: `"${title}" appears twice in "${module.title}"`,
        });
      }
      lesson = { title, minutes: null, video: null, poster: null, body: [], line, seen: new Set() };
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
      // The lines right after the title, before any text: `minutes:`, and `BE-W210`'s `Video:` and
      // `Poster:`. Once the text has begun, a line like these is lesson text.
      const meta = /^(minutes|video|poster):\s*(.*)$/iu.exec(raw.trim());
      if (meta !== null && lesson.body.every((b) => b.trim() === '')) {
        const key = meta[1].toLowerCase();
        const value = (meta[2] ?? '').trim();
        if (lesson.seen.has(key)) {
          problems.push({
            code: 'duplicate_line',
            line,
            detail: `"${lesson.title}" has a second "${key}:" line`,
          });
          return;
        }
        lesson.seen.add(key);
        if (key === 'minutes') {
          const n = Number(value);
          if (!Number.isInteger(n) || n <= 0) {
            problems.push({
              code: 'bad_minutes',
              line,
              detail: `"${value}" is not a whole number of minutes above 0`,
            });
          } else {
            lesson.minutes = n;
          }
        } else if (key === 'video') {
          if (!/\.mp4$/iu.test(value)) {
            problems.push({
              code: 'bad_video',
              line,
              detail: `"${value}" is not an .mp4 file — make one with pnpm video:trim`,
            });
          } else {
            lesson.video = { path: value, line };
          }
        } else if (!/\.jpe?g$/iu.test(value)) {
          problems.push({ code: 'bad_poster', line, detail: `"${value}" is not a .jpg file` });
        } else {
          lesson.poster = { path: value, line };
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
  for (const m of course.modules) {
    for (const l of m.lessons) {
      if (l.poster !== null && l.video === null && !l.seen.has('video')) {
        problems.push({
          code: 'poster_without_video',
          line: l.poster.line,
          detail: `"${l.title}" has a Poster: line and no Video: line`,
        });
      }
      delete l.seen;
    }
  }
  return { course, problems };
};

/**
 * `BE-W210` — the clip files a course names: present, within the 50 MiB limit, and (when `ffprobe` is
 * on PATH) a phone-playable H.264/AAC MP4. Paths are relative to the course file's folder. Annotates each
 * lesson's `video` / `poster` with the resolved `file`, its `bytes` and the clip's measured
 * `durationSeconds`. No network.
 *
 * @param {ReturnType<typeof checkCourse>['course']} course
 * @param {{ baseDir: string, sizeOf?: (file: string) => number | null, probe?: ((file: string) => import('./trim-video.mjs').ProbeFacts) | null }} options
 */
export const checkCourseMedia = (course, { baseDir, sizeOf, probe }) => {
  const size =
    sizeOf ??
    ((file) => (existsSync(file) && statSync(file).isFile() ? statSync(file).size : null));
  const ffprobe = probe === undefined ? findTool('ffprobe') : null;
  const measure =
    probe === undefined ? (ffprobe === null ? null : (file) => probeFile(ffprobe, file)) : probe;
  const problems = [];
  const notes = [];
  let clips = 0;
  for (const m of course.modules) {
    for (const l of m.lessons) {
      for (const kind of ['video', 'poster']) {
        const ref = l[kind];
        if (ref === null || ref === undefined) continue;
        const file = isAbsolute(ref.path) ? ref.path : resolve(baseDir, ref.path);
        const bytes = size(file);
        if (bytes === null) {
          problems.push({
            code: `${kind}_missing`,
            line: ref.line,
            detail: `"${l.title}": ${ref.path} does not exist (paths are relative to the course file)`,
          });
          continue;
        }
        if (bytes > LIMIT_BYTES) {
          problems.push({
            code: `${kind}_too_large`,
            line: ref.line,
            detail: `"${l.title}": ${ref.path} is ${(bytes / 1_000_000).toFixed(1)} MB; the limit is 50 MiB — trim it with pnpm video:trim, or cut it shorter`,
          });
          continue;
        }
        ref.file = file;
        ref.bytes = bytes;
        if (kind !== 'video') continue;
        clips += 1;
        ref.durationSeconds = null;
        if (measure === null) continue;
        try {
          const facts = measure(file);
          ref.durationSeconds = facts.durationSeconds;
          const wrong = playabilityProblems(facts);
          if (wrong.length > 0) {
            problems.push({
              code: 'video_not_playable',
              line: ref.line,
              detail: `"${l.title}": ${ref.path} — ${wrong.join('; ')}. Make it with pnpm video:trim`,
            });
          }
        } catch (error) {
          problems.push({
            code: 'video_not_playable',
            line: ref.line,
            detail: `"${l.title}": ffprobe could not read ${ref.path} (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
          });
        }
      }
    }
  }
  if (clips > 0 && measure === null) {
    notes.push(
      'ffprobe is not on PATH, so the clips were checked for size only — not for H.264/AAC, and their length is not recorded. Install it: winget install Gyan.FFmpeg',
    );
  }
  return { problems, notes, clips };
};

const sha16 = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16);

/**
 * One file into `lesson-videos`, as the signed-in admin — the storage policy decides. An object that is
 * already there under this content-hash name is this same content (a repeated load): carried on with.
 */
export const uploadLessonFile = async ({
  url,
  apiKey,
  token,
  objectPath,
  body,
  contentType,
  fetchImpl = fetch,
}) => {
  const res = await fetchImpl(`${url}/storage/v1/object/lesson-videos/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${token}`,
      'content-type': contentType,
      'x-upsert': 'false',
      'cache-control': 'max-age=3600',
    },
    body,
  });
  if (res.ok) return 'uploaded';
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (res.status === 409 || String(parsed?.statusCode) === '409' || parsed?.error === 'Duplicate')
    return 'already there';
  throw new Error(
    `upload of ${objectPath} refused (${String(res.status)}): ${String(parsed?.message ?? text)}`,
  );
};

/**
 * Check against the company, then write the draft. Throws on any refusal; writes NOTHING unless
 * every check passed. On a failure part-way, removes what it wrote (all of it draft, never seen by a rep).
 */
export const loadCourse = async (course, { url, apiKey, email, password, fetchImpl, baseDir }) => {
  // The clips are checked before anything is signed into, the same as the text.
  const unchecked = course.modules.some((m) =>
    m.lessons.some((l) => (l.video ?? null) !== null && l.video.file === undefined),
  );
  if (unchecked) {
    const media = checkCourseMedia(course, { baseDir: baseDir ?? process.cwd() });
    if (media.problems.length > 0) {
      const error = new Error(`NOTHING WRITTEN. Refused:\n${formatProblems(media.problems)}`);
      error.problems = media.problems;
      throw error;
    }
  }
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
  let videos = 0;
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
        if ((l.video ?? null) !== null) {
          // `BE-W210` — the clip (and poster) into THIS lesson's folder of THIS draft, then the lesson
          // names them. The database refuses a name whose object is not in the bucket.
          const folder = `${me.organisation_id}/${version.id}/${lesson.id}/`;
          const clip = readFileSync(l.video.file);
          const videoPath = `${folder}video-${sha16(clip)}.mp4`;
          await uploadLessonFile({
            url,
            apiKey,
            token: session.token,
            objectPath: videoPath,
            body: clip,
            contentType: 'video/mp4',
            fetchImpl,
          });
          let posterPath = null;
          if ((l.poster ?? null) !== null) {
            const poster = readFileSync(l.poster.file);
            posterPath = `${folder}poster-${sha16(poster)}.jpg`;
            await uploadLessonFile({
              url,
              apiKey,
              token: session.token,
              objectPath: posterPath,
              body: poster,
              contentType: 'image/jpeg',
              fetchImpl,
            });
          }
          const seconds = l.video.durationSeconds ?? null;
          await rest.update(`lessons?id=eq.${lesson.id}`, {
            video_object_path: videoPath,
            video_poster_path: posterPath,
            video_duration_seconds: seconds === null ? null : Math.max(1, Math.round(seconds)),
          });
          videos += 1;
        }
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
      videos,
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
      `LOAD FAILED part-way: ${error instanceof Error ? error.message : String(error)}. Its modules and lessons were removed; an empty draft version may remain (reps never see a draft); run the load again and it is reused.${videos > 0 ? ' Clips already uploaded stay in the draft folder, unreadable by reps.' : ''}`,
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
  const media = checkCourseMedia(course, { baseDir: dirname(resolve(file)) });
  for (const line of media.notes) console.log(`NOTE: ${line}`);
  if (media.problems.length > 0) {
    console.error(
      `NOTHING WRITTEN. ${file} has ${String(media.problems.length)} problem(s) with its clips:\n${formatProblems(media.problems)}`,
    );
    process.exit(1);
  }
  const clips = media.clips === 0 ? '' : `, ${String(media.clips)} video(s)`;
  if (!args.includes('--write')) {
    console.log(
      `${file} is loadable: "${course.title}", ${String(course.modules.length)} module(s), ${String(lessons)} lesson(s)${clips}. Nothing written (no --write).`,
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
      `DRAFT written: "${course.title}" version ${String(out.versionNumber)}, ${String(out.modules)} module(s), ${String(out.lessons)} lesson(s)${out.videos === 0 ? '' : `, ${String(out.videos)} video(s) uploaded`}. When it has been read — and any clinical content approved by the client's medical/regulatory reviewer — publish it in the console (Courses) or with content-step.mjs publish-course "${course.title}".`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
