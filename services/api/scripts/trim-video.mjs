#!/usr/bin/env node
/**
 * `BE-W209` — `pnpm video:trim`: one section of a long conference video in, one phone-sized lesson
 * clip and its poster out.
 *
 * **Why it exists.** The client's conference videos are 0.6–4.2 GB each. A lesson clip lives in
 * Supabase Storage (`lesson-videos`, `BE-W208`), where one object may be at most **50 MiB** — the Free
 * plan's per-file limit, and `file_size_limit` in `services/api/supabase/config.toml` and on the
 * bucket. So a section is cut out and re-encoded to what a mid-range Android phone plays well on a
 * mobile connection, and is made to fit:
 *
 *   H.264 High, yuv420p, at most 720p and 30 fps · AAC stereo, 128 kbps (96 when the budget is tight)
 *   · `+faststart` (the index first, so the phone starts playing before the whole file arrives)
 *
 * **How the size is made to fit.** The video bitrate is chosen from the clip's length so the file
 * lands under **48 MB** (`TARGET_BYTES` — 2 MB of headroom under the 50 MiB limit): the whole budget
 * in bits, divided by the seconds, less a margin for the container and the encoder's overshoot, less
 * the audio. A long clip gets a lower bitrate and, below what 720p needs to look acceptable, a lower
 * resolution (540p, 480p, 360p — `RUNGS`). If the file still comes out over 48 MB it is encoded again
 * at a bitrate scaled down by how much it overshot. A clip that would need less than 360p's floor is
 * REFUSED before anything is encoded, with the longest length that fits: cut it shorter, or into two
 * lessons.
 *
 *   pnpm video:trim --in <source.mp4> --from HH:MM:SS --to HH:MM:SS --out <clip.mp4> [--poster <p.jpg>]
 *
 * The poster (a JPEG of the frame about 10% into the clip) is written beside the clip as
 * `<clip>.jpg` unless `--poster` names another path. Both go on the lesson in the course file:
 * `Video: <clip.mp4>` and `Poster: <clip.jpg>` (`docs/operator/lesson-videos.md`).
 *
 * **It uses the system's `ffmpeg` and `ffprobe`** (on this project's Windows machines:
 * `winget install Gyan.FFmpeg`), found on PATH — or at `FFMPEG_PATH` / `FFPROBE_PATH` when set. It adds
 * no dependency to the repository. Absent, it stops and says how to install them.
 *
 * Everything that decides something — the arguments, the time format, the bitrate maths, the retry,
 * the ffmpeg command line — is a pure export, tested in `tests/trim-video.spec.ts` without ffmpeg.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

/** The bucket's and the Free plan's per-file limit: 50 MiB. */
export const LIMIT_BYTES = 50 * 1024 * 1024;
/** What a clip is encoded to land under: 48 MB, leaving room under the 50 MiB limit. */
export const TARGET_BYTES = 48_000_000;
/** The share of the bit budget given to audio and video; the rest is the container and overshoot. */
export const MUX_MARGIN = 0.95;
/** How many encodes before a clip is refused. */
export const MAX_ATTEMPTS = 3;

/**
 * The resolutions a clip may be encoded at, best first, with the video bitrate each needs to look
 * acceptable (`minKbps`) and above which a talking-head lecture gains nothing visible (`maxKbps`).
 */
export const RUNGS = [
  { height: 720, minKbps: 700, maxKbps: 1500 },
  { height: 540, minKbps: 450, maxKbps: 1000 },
  { height: 480, minKbps: 300, maxKbps: 800 },
  { height: 360, minKbps: 160, maxKbps: 500 },
];

const AUDIO_KBPS_FULL = 128;
const AUDIO_KBPS_LEAN = 96;

/**
 * `HH:MM:SS`, `MM:SS` or seconds, each optionally with a decimal fraction. Null when it is none of them.
 * @param {string} text
 * @returns {number | null}
 */
export const parseTimestamp = (text) => {
  const s = String(text).trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/u.test(s)) return null;
  const [whole, fraction = ''] = s.split('.');
  const parts = whole.split(':').map(Number);
  // Below the leading part, minutes and seconds are 0–59: "1:75" is a typo, not 2:15.
  if (parts.slice(1).some((n) => n > 59)) return null;
  const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
  return fraction === '' ? seconds : seconds + Number(`0.${fraction}`);
};

/** `754` → `"12:34"`, `3723` → `"1:02:03"`. */
export const formatDuration = (seconds) => {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${String(h)}:${two(m)}:${two(sec)}` : `${String(m)}:${two(sec)}`;
};

const OPTIONS = new Set(['--in', '--from', '--to', '--out', '--poster']);

/**
 * The command line, checked. Every problem at once; nothing is read from disk here.
 * @param {string[]} argv
 */
export const parseTrimArgs = (argv) => {
  const problems = [];
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help') {
      values.help = true;
      continue;
    }
    if (!OPTIONS.has(a)) {
      problems.push(`"${a}" is not an option — the options are ${[...OPTIONS].join(', ')}`);
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      problems.push(`${a} needs a value`);
      continue;
    }
    values[a.slice(2)] = v;
    i += 1;
  }
  for (const required of ['in', 'from', 'to', 'out']) {
    if (values[required] === undefined && !values.help) problems.push(`--${required} is missing`);
  }
  const from = values.from === undefined ? null : parseTimestamp(values.from);
  const to = values.to === undefined ? null : parseTimestamp(values.to);
  if (values.from !== undefined && from === null)
    problems.push(`--from "${values.from}" is not a time — write HH:MM:SS, MM:SS or seconds`);
  if (values.to !== undefined && to === null)
    problems.push(`--to "${values.to}" is not a time — write HH:MM:SS, MM:SS or seconds`);
  if (from !== null && to !== null && to <= from)
    problems.push(`--to (${values.to}) must be after --from (${values.from})`);
  if (values.out !== undefined && !/\.mp4$/iu.test(values.out))
    problems.push(`--out "${values.out}" must end in .mp4`);
  if (values.poster !== undefined && !/\.jpe?g$/iu.test(values.poster))
    problems.push(`--poster "${values.poster}" must end in .jpg`);
  if (
    values.in !== undefined &&
    values.out !== undefined &&
    resolve(values.in).toLowerCase() === resolve(values.out).toLowerCase()
  )
    problems.push('--out is the same file as --in; the source would be overwritten');
  const poster =
    values.poster ?? (values.out === undefined ? null : values.out.replace(/\.mp4$/iu, '.jpg'));
  return {
    help: values.help === true,
    input: values.in ?? null,
    out: values.out ?? null,
    poster,
    from,
    to,
    duration: from !== null && to !== null && to > from ? to - from : null,
    problems,
  };
};

/**
 * The encode for a video bitrate: the best rung that bitrate can carry, capped at that rung's ceiling.
 * Null when the bitrate is below even the lowest rung's floor.
 */
const onRung = (videoKbps, audioKbps, durationSeconds) => {
  const rung = RUNGS.find((r) => videoKbps >= r.minKbps);
  if (rung === undefined) return null;
  const v = Math.min(Math.floor(videoKbps), rung.maxKbps);
  return {
    height: rung.height,
    videoKbps: v,
    audioKbps,
    // A ceiling the encoder may borrow up to on a busy scene, and the window it averages over.
    maxrateKbps: Math.round(v * 1.5),
    bufsizeKbps: v * 2,
    expectedBytes: Math.round(((v + audioKbps) * 1000 * durationSeconds) / 8),
  };
};

/** The longest clip that fits at the lowest rung: the number to tell someone whose clip is too long. */
export const maxFittingSeconds = (targetBytes = TARGET_BYTES) =>
  Math.floor(
    (targetBytes * 8 * MUX_MARGIN) / ((RUNGS[RUNGS.length - 1].minKbps + AUDIO_KBPS_LEAN) * 1000),
  );

/**
 * The first encode for a clip of this length: `{ ok: true, ...plan }`, or `{ ok: false, reason }` when
 * no rung fits — the clip must be cut shorter.
 * @param {number} durationSeconds
 * @param {number} [targetBytes]
 */
export const planEncode = (durationSeconds, targetBytes = TARGET_BYTES) => {
  if (!(durationSeconds > 0)) return { ok: false, reason: 'the clip has no length' };
  const totalKbps = (targetBytes * 8 * MUX_MARGIN) / durationSeconds / 1000;
  const audioKbps = totalKbps >= 1000 ? AUDIO_KBPS_FULL : AUDIO_KBPS_LEAN;
  const plan = onRung(totalKbps - audioKbps, audioKbps, durationSeconds);
  if (plan === null) {
    const most = maxFittingSeconds(targetBytes);
    return {
      ok: false,
      reason:
        `a ${formatDuration(durationSeconds)} clip cannot fit under ${String(targetBytes / 1_000_000)} MB ` +
        `even at 360p. Cut it shorter — at most about ${formatDuration(most)} — or split it into two lessons.`,
    };
  }
  return { ok: true, ...plan };
};

/**
 * After an encode came out at `actualBytes` (over the target): the next, smaller encode, scaled by how
 * far it overshot with a further 10% margin — or a refusal when even 360p's floor would not fit.
 */
export const nextPlan = (previous, actualBytes, durationSeconds, targetBytes = TARGET_BYTES) => {
  const scaled = previous.videoKbps * (targetBytes / actualBytes) * 0.9;
  // Never retry at the same or a higher bitrate: that would produce the same file again.
  const videoKbps = Math.min(scaled, previous.videoKbps - 1);
  const plan = onRung(videoKbps, previous.audioKbps, durationSeconds);
  if (plan === null) {
    return {
      ok: false,
      reason:
        `even at 360p the clip came out over ${String(targetBytes / 1_000_000)} MB. ` +
        `Cut it shorter — at most about ${formatDuration(maxFittingSeconds(targetBytes))}.`,
    };
  }
  return { ok: true, ...plan };
};

/**
 * The ffmpeg arguments for one encode. Input-side `-ss` seeks without decoding the hours before it —
 * the sources are up to 4 GB — and `-t` is the clip's length.
 */
export const ffmpegArgs = ({ input, from, duration, out, plan }) => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-stats',
  '-y',
  '-ss',
  String(from),
  '-i',
  input,
  '-t',
  String(duration),
  '-map',
  '0:v:0',
  // The `?`: a source with no audio track still encodes.
  '-map',
  '0:a:0?',
  // Never upscaled; the height kept even, which yuv420p needs.
  '-vf',
  `scale=w=-2:h='trunc(min(${String(plan.height)},ih)/2)*2':flags=lanczos,format=yuv420p`,
  '-fpsmax',
  '30',
  '-c:v',
  'libx264',
  '-profile:v',
  'high',
  '-level:v',
  '4.0',
  '-preset',
  'medium',
  '-pix_fmt',
  'yuv420p',
  '-b:v',
  `${String(plan.videoKbps)}k`,
  '-maxrate',
  `${String(plan.maxrateKbps)}k`,
  '-bufsize',
  `${String(plan.bufsizeKbps)}k`,
  '-c:a',
  'aac',
  '-b:a',
  `${String(plan.audioKbps)}k`,
  '-ac',
  '2',
  '-ar',
  '48000',
  '-movflags',
  '+faststart',
  out,
];

/** The poster: one JPEG frame of the finished clip, about 10% in (past any title card or black). */
export const posterArgs = ({ clip, duration, poster }) => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-ss',
  String(Math.round(duration * 0.1 * 100) / 100),
  '-i',
  clip,
  '-frames:v',
  '1',
  '-q:v',
  '3',
  poster,
];

/**
 * A tool on PATH (or at its `*_PATH` override), as an absolute path; null when absent.
 * @param {'ffmpeg' | 'ffprobe'} name
 */
export const findTool = (name, env = process.env, exists = existsSync) => {
  const override = env[`${name.toUpperCase()}_PATH`];
  if (override !== undefined && override !== '') return exists(override) ? override : null;
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : [''];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (dir === '') continue;
    for (const ext of ['', ...exts]) {
      const candidate = join(dir.replace(/^"|"$/gu, ''), `${name}${ext.toLowerCase()}`);
      if (exists(candidate) && (process.platform !== 'win32' || ext !== '')) return candidate;
    }
  }
  return null;
};

/** Say what is missing and how to get it. */
export const missingToolMessage = (name) =>
  `${name} was not found on PATH. Install it (Windows: winget install Gyan.FFmpeg — then open a NEW ` +
  `terminal so PATH is re-read), or set ${name.toUpperCase()}_PATH to the ${name} executable.`;

/** ffprobe's JSON for a file → the facts the loader and the summary need. */
export const describeProbe = (json) => {
  const streams = Array.isArray(json?.streams) ? json.streams : [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(json?.format?.duration);
  const size = Number(json?.format?.size);
  return {
    durationSeconds: Number.isFinite(duration) ? duration : null,
    sizeBytes: Number.isFinite(size) ? size : null,
    video:
      v === undefined
        ? null
        : {
            codec: String(v.codec_name ?? ''),
            profile: String(v.profile ?? ''),
            pixFmt: String(v.pix_fmt ?? ''),
            width: Number(v.width ?? 0),
            height: Number(v.height ?? 0),
          },
    audio:
      a === undefined
        ? null
        : { codec: String(a.codec_name ?? ''), channels: Number(a.channels ?? 0) },
  };
};

/**
 * What would stop a phone playing this clip well, from ffprobe's facts. Empty when it is fine.
 * @param {ReturnType<typeof describeProbe>} d
 */
export const playabilityProblems = (d) => {
  const problems = [];
  if (d.video === null) problems.push('it has no video track');
  else {
    if (d.video.codec !== 'h264')
      problems.push(`its video is ${d.video.codec || 'unknown'}, not H.264`);
    if (d.video.pixFmt !== '' && d.video.pixFmt !== 'yuv420p')
      problems.push(`its pixel format is ${d.video.pixFmt}, not yuv420p`);
    if (d.video.height > 720) problems.push(`it is ${String(d.video.height)}p, above 720p`);
  }
  if (d.audio !== null && d.audio.codec !== 'aac')
    problems.push(`its audio is ${d.audio.codec || 'unknown'}, not AAC`);
  return problems;
};

/** Runs ffprobe on a file. Throws with ffprobe's own message when it cannot read it. */
export const probeFile = (ffprobe, file) => {
  const out = execFileSync(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size:stream=codec_type,codec_name,profile,pix_fmt,width,height,channels',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return describeProbe(JSON.parse(out));
};

const mb = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;

const say = (line = '') => process.stdout.write(`${line}\n`);

const USAGE =
  'usage: pnpm video:trim --in <source.mp4> --from HH:MM:SS --to HH:MM:SS --out <clip.mp4> [--poster <poster.jpg>]\n' +
  '       (docs/operator/lesson-videos.md)';

const main = (argv) => {
  const args = parseTrimArgs(argv);
  if (args.help) {
    say(USAGE);
    return 0;
  }
  if (args.problems.length > 0) {
    process.stderr.write(`NOTHING WRITTEN.\n  ${args.problems.join('\n  ')}\n${USAGE}\n`);
    return 2;
  }
  const ffmpeg = findTool('ffmpeg');
  const ffprobe = findTool('ffprobe');
  for (const [name, path] of [
    ['ffmpeg', ffmpeg],
    ['ffprobe', ffprobe],
  ]) {
    if (path === null) {
      process.stderr.write(`NOTHING WRITTEN. ${missingToolMessage(name)}\n`);
      return 2;
    }
  }
  if (!existsSync(args.input)) {
    process.stderr.write(`NOTHING WRITTEN. --in "${args.input}" does not exist.\n`);
    return 2;
  }
  const source = probeFile(ffprobe, args.input);
  if (source.video === null) {
    process.stderr.write(`NOTHING WRITTEN. "${args.input}" has no video track.\n`);
    return 2;
  }
  if (source.durationSeconds !== null && args.to > source.durationSeconds + 0.5) {
    process.stderr.write(
      `NOTHING WRITTEN. --to is after the end of the video, which is ${formatDuration(source.durationSeconds)} long.\n`,
    );
    return 2;
  }

  say(
    `Cutting ${formatDuration(args.from)}–${formatDuration(args.to)} (${formatDuration(args.duration)}) ` +
      `from ${args.input} (${String(source.video.width)}x${String(source.video.height)}).`,
  );
  let plan = planEncode(args.duration);
  for (let attempt = 1; ; attempt += 1) {
    if (!plan.ok) {
      process.stderr.write(`REFUSED: ${plan.reason}\n`);
      return 1;
    }
    say(
      `  encode ${String(attempt)}: up to ${String(plan.height)}p, video ${String(plan.videoKbps)} kbps, ` +
        `audio ${String(plan.audioKbps)} kbps — expected about ${mb(plan.expectedBytes)}`,
    );
    execFileSync(
      ffmpeg,
      ffmpegArgs({
        input: args.input,
        from: args.from,
        duration: args.duration,
        out: args.out,
        plan,
      }),
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    const size = statSync(args.out).size;
    if (size <= TARGET_BYTES) break;
    say(`  came out at ${mb(size)}, over ${mb(TARGET_BYTES)}; encoding again smaller`);
    if (attempt >= MAX_ATTEMPTS) {
      process.stderr.write(
        `REFUSED: still ${mb(size)} after ${String(MAX_ATTEMPTS)} encodes. Cut the clip shorter. ` +
          `${args.out} is left on disk but must NOT be loaded.\n`,
      );
      return 1;
    }
    plan = nextPlan(plan, size, args.duration);
  }

  execFileSync(
    ffmpeg,
    posterArgs({ clip: args.out, duration: args.duration, poster: args.poster }),
    {
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  const clip = probeFile(ffprobe, args.out);
  const problems = playabilityProblems(clip);
  say('');
  say(`CLIP READY: ${args.out}`);
  say(
    `  duration   ${formatDuration(clip.durationSeconds ?? args.duration)} (${String(Math.round(clip.durationSeconds ?? args.duration))} s)`,
  );
  say(
    `  size       ${mb(clip.sizeBytes ?? 0)} (${String(clip.sizeBytes)} bytes; the limit is 50 MiB = ${String(LIMIT_BYTES)})`,
  );
  say(
    `  video      ${String(clip.video?.width)}x${String(clip.video?.height)} ${clip.video?.codec ?? '?'} ${clip.video?.profile ?? ''}`.trimEnd(),
  );
  say(
    `  audio      ${clip.audio === null ? 'none' : `${clip.audio.codec} ${String(clip.audio.channels)} channel(s)`}`,
  );
  say(`  poster     ${args.poster}`);
  if (problems.length > 0) say(`  WARNING: ${problems.join('; ')}`);
  say('');
  say(
    'Next: under the lesson in your course file, the line right after its ### title (or minutes:)',
  );
  say(`  Video: ${args.out}`);
  say(`  Poster: ${args.poster}`);
  return problems.length > 0 ? 1 : 0;
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `video:trim STOPPED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
