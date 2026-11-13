import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIMIT_BYTES,
  MUX_MARGIN,
  RUNGS,
  TARGET_BYTES,
  describeProbe,
  ffmpegArgs,
  findTool,
  formatDuration,
  maxFittingSeconds,
  nextPlan,
  parseTimestamp,
  parseTrimArgs,
  planEncode,
  playabilityProblems,
  posterArgs,
} from '../scripts/trim-video.mjs';
import type { EncodePlan, ProbeFacts } from '../scripts/trim-video.mjs';
import { checkCourse, checkCourseMedia } from '../scripts/load-course.mjs';

/**
 * `BE-W209` / `BE-W210` — the clip trimmer's decisions and the course file's `Video:` lines, with no
 * ffmpeg and no database: every function here is pure, or takes its file system and ffprobe injected.
 * The real encode is exercised by `pnpm key-day` (a generated TEST clip) and by the owner's first trim.
 */

const ARGS = ['--in', 'talk.mp4', '--from', '00:12:00', '--to', '00:19:30', '--out', 'clip.mp4'];

describe('video:trim — the command line', () => {
  it('reads HH:MM:SS, MM:SS and seconds, with fractions, and refuses anything else', () => {
    expect(parseTimestamp('01:02:03')).toBe(3723);
    expect(parseTimestamp('1:02:03.5')).toBe(3723.5);
    expect(parseTimestamp('12:30')).toBe(750);
    expect(parseTimestamp('90')).toBe(90);
    expect(parseTimestamp('0')).toBe(0);
    for (const bad of ['', 'abc', '1:75', '00:61:00', '-5', '1::2', '1:2:3:4', '10m']) {
      expect(parseTimestamp(bad), bad).toBeNull();
    }
    expect(formatDuration(450)).toBe('7:30');
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('a good command: the clip length and a poster beside the clip', () => {
    const a = parseTrimArgs(ARGS);
    expect(a.problems).toEqual([]);
    expect(a).toMatchObject({
      input: 'talk.mp4',
      out: 'clip.mp4',
      poster: 'clip.jpg',
      from: 720,
      to: 1170,
      duration: 450,
    });
    expect(parseTrimArgs([...ARGS, '--poster', 'p.jpg']).poster).toBe('p.jpg');
  });

  it('every problem at once: missing, unknown, malformed, backwards, wrong extension, overwrite', () => {
    expect(parseTrimArgs([]).problems).toEqual([
      '--in is missing',
      '--from is missing',
      '--to is missing',
      '--out is missing',
    ]);
    const bad = parseTrimArgs([
      '--in',
      'talk.mp4',
      '--from',
      '00:20:00',
      '--to',
      '00:10:00',
      '--out',
      'clip.mov',
      '--poster',
      'p.png',
      '--speed',
    ]);
    expect(bad.problems).toEqual([
      '"--speed" is not an option — the options are --in, --from, --to, --out, --poster',
      '--to (00:10:00) must be after --from (00:20:00)',
      '--out "clip.mov" must end in .mp4',
      '--poster "p.png" must end in .jpg',
    ]);
    expect(
      parseTrimArgs(['--in', 'x.mp4', '--from', '1', '--to', 'soon', '--out']).problems,
    ).toEqual([
      '--out needs a value',
      '--out is missing',
      '--to "soon" is not a time — write HH:MM:SS, MM:SS or seconds',
    ]);
    expect(
      parseTrimArgs(['--in', 'a.mp4', '--from', '0', '--to', '9', '--out', 'A.MP4']).problems,
    ).toEqual(['--out is the same file as --in; the source would be overwritten']);
  });
});

describe('video:trim — the size maths (48 MB target, 50 MiB limit)', () => {
  const bytesOf = (p: EncodePlan, seconds: number) =>
    ((p.videoKbps + p.audioKbps) * 1000 * seconds) / 8;

  it('the target leaves headroom under the limit', () => {
    expect(LIMIT_BYTES).toBe(52_428_800);
    expect(TARGET_BYTES).toBeLessThan(LIMIT_BYTES);
    expect(MUX_MARGIN).toBeLessThan(1);
  });

  it("a short clip is capped at 720p's ceiling rather than wasting the budget", () => {
    const p = planEncode(120);
    expect(p).toMatchObject({ ok: true, height: 720, videoKbps: 1500, audioKbps: 128 });
  });

  it('every length that fits plans under the target, and steps down in resolution as it grows', () => {
    let lastHeight = 10_000;
    for (let seconds = 30; seconds <= maxFittingSeconds(); seconds += 30) {
      const p = planEncode(seconds);
      if (!p.ok) throw new Error(`${String(seconds)} s refused: ${p.reason}`);
      expect(bytesOf(p, seconds), `${String(seconds)} s`).toBeLessThanOrEqual(
        TARGET_BYTES * MUX_MARGIN + 1,
      );
      const rung = RUNGS.find((r) => r.height === p.height);
      expect(p.videoKbps).toBeGreaterThanOrEqual(rung?.minKbps ?? Infinity);
      expect(p.videoKbps).toBeLessThanOrEqual(rung?.maxKbps ?? 0);
      expect(p.height).toBeLessThanOrEqual(lastHeight);
      lastHeight = p.height;
      expect(p.maxrateKbps).toBeGreaterThan(p.videoKbps);
    }
    expect(planEncode(600)).toMatchObject({ ok: true, height: 540, audioKbps: 96 });
    expect(planEncode(1200)).toMatchObject({ ok: true, height: 360 });
  });

  it('a clip too long for even 360p is refused BEFORE encoding, with the length that would fit', () => {
    const most = maxFittingSeconds();
    expect(most).toBeGreaterThan(20 * 60); // about 23 minutes
    expect(planEncode(most).ok).toBe(true);
    const tooLong = planEncode(most + 60);
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.reason).toMatch(/Cut it shorter — at most about 23:\d\d/u);
    expect(planEncode(0).ok).toBe(false);
  });

  it('an encode that overshoots is retried smaller — never at the same bitrate — and refused at the floor', () => {
    const first = planEncode(300);
    if (!first.ok) throw new Error('300 s should fit');
    const second = nextPlan(first, TARGET_BYTES * 1.1, 300);
    if (!second.ok) throw new Error('a 10% overshoot should be retried');
    expect(second.videoKbps).toBeLessThan(first.videoKbps);
    expect(second.videoKbps).toBeLessThanOrEqual(first.videoKbps / 1.1);
    // A tiny overshoot still moves the bitrate down.
    const nudge = nextPlan(first, TARGET_BYTES + 1, 300);
    expect(nudge.ok && nudge.videoKbps < first.videoKbps).toBe(true);
    // At 360p's floor there is nowhere left to go.
    const floor: EncodePlan = { ...first, height: 360, videoKbps: 160 };
    expect(nextPlan(floor, TARGET_BYTES * 1.2, 300).ok).toBe(false);
  });
});

describe('video:trim — what is asked of ffmpeg', () => {
  const plan: EncodePlan = {
    height: 540,
    videoKbps: 900,
    audioKbps: 96,
    maxrateKbps: 1350,
    bufsizeKbps: 1800,
    expectedBytes: 1,
  };

  it('phone-friendly: H.264 High yuv420p, never upscaled, even height, AAC stereo, faststart', () => {
    const args = ffmpegArgs({ input: 'in.mp4', from: 720, duration: 450, out: 'o.mp4', plan });
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    // Seek on the INPUT side, before -i: a 4 GB source is not decoded up to the cut.
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(after('-ss')).toBe('720');
    expect(after('-t')).toBe('450');
    expect(after('-c:v')).toBe('libx264');
    expect(after('-profile:v')).toBe('high');
    expect(after('-pix_fmt')).toBe('yuv420p');
    expect(after('-vf')).toContain("h='trunc(min(540,ih)/2)*2'");
    expect(after('-fpsmax')).toBe('30');
    expect(after('-b:v')).toBe('900k');
    expect(after('-maxrate')).toBe('1350k');
    expect(after('-c:a')).toBe('aac');
    expect(after('-b:a')).toBe('96k');
    expect(after('-ac')).toBe('2');
    expect(after('-movflags')).toBe('+faststart');
    expect(args.at(-1)).toBe('o.mp4');
    expect(args).toContain('0:a:0?');
  });

  it('the poster is one frame about 10% into the finished clip', () => {
    const args = posterArgs({ clip: 'o.mp4', duration: 450, poster: 'o.jpg' });
    expect(args[args.indexOf('-ss') + 1]).toBe('45');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
    expect(args.at(-1)).toBe('o.jpg');
  });

  it('finds ffmpeg on PATH, honours an override, and says null when it is absent', () => {
    // A directory in this platform's own spelling: PATH is split on `:` off Windows, so the
    // Windows drive letter cut the entry in two on CI's Linux runner and nothing was found.
    const dir =
      process.platform === 'win32'
        ? join('C:', 'tools', 'ffmpeg', 'bin')
        : join('/opt', 'tools', 'ffmpeg', 'bin');
    const exe = process.platform === 'win32' ? '.exe' : '';
    const has = (want: string) => (p: string) => p === want;
    expect(findTool('ffmpeg', { PATH: dir, PATHEXT: '.EXE' }, has(join(dir, `ffmpeg${exe}`)))).toBe(
      join(dir, `ffmpeg${exe}`),
    );
    expect(findTool('ffprobe', { PATH: dir }, () => false)).toBeNull();
    expect(findTool('ffmpeg', { FFMPEG_PATH: 'X:/ff.exe', PATH: dir }, has('X:/ff.exe'))).toBe(
      'X:/ff.exe',
    );
    expect(findTool('ffmpeg', { FFMPEG_PATH: 'X:/gone.exe', PATH: dir }, () => false)).toBeNull();
  });

  it("reads ffprobe's answer, and names what a phone would not play", () => {
    const good = describeProbe({
      format: { duration: '450.04', size: '41000000' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          profile: 'High',
          pix_fmt: 'yuv420p',
          width: 960,
          height: 540,
        },
        { codec_type: 'audio', codec_name: 'aac', channels: 2 },
      ],
    });
    expect(good).toMatchObject({ durationSeconds: 450.04, sizeBytes: 41_000_000 });
    expect(playabilityProblems(good)).toEqual([]);
    const bad: ProbeFacts = {
      durationSeconds: 10,
      sizeBytes: 1,
      video: {
        codec: 'hevc',
        profile: 'Main 10',
        pixFmt: 'yuv420p10le',
        width: 3840,
        height: 2160,
      },
      audio: { codec: 'opus', channels: 2 },
    };
    expect(playabilityProblems(bad)).toEqual([
      'its video is hevc, not H.264',
      'its pixel format is yuv420p10le, not yuv420p',
      'it is 2160p, above 720p',
      'its audio is opus, not AAC',
    ]);
    expect(playabilityProblems(describeProbe({ streams: [] }))).toEqual(['it has no video track']);
  });
});

const COURSE = (body: string) => `---\ncourse: Real course\nmarket: any\n---\n${body}`;
const codes = (problems: { code: string }[]) => problems.map((p) => p.code);

describe('the course file — Video: and Poster: lines (BE-W210)', () => {
  it('right after the title, in any order with minutes:, case-insensitive; later they are text', () => {
    const { course, problems } = checkCourse(
      COURSE(
        '## M\n### Phenotypes\nminutes: 6\nVideo: clips/pheno.mp4\nposter: clips/pheno.jpg\nThe four phenotypes.\nVideo: not-a-line.mp4',
      ),
    );
    expect(problems).toEqual([]);
    expect(course.modules[0]?.lessons[0]).toMatchObject({
      minutes: 6,
      video: { path: 'clips/pheno.mp4', line: 8 },
      poster: { path: 'clips/pheno.jpg', line: 9 },
      body: 'The four phenotypes.\nVideo: not-a-line.mp4',
    });
    const plain = checkCourse(COURSE('## M\n### L\ntext'));
    expect(plain.course.modules[0]?.lessons[0]).toMatchObject({ video: null, poster: null });
  });

  it('each refusal, by its code and line', () => {
    expect(codes(checkCourse(COURSE('## M\n### L\nVideo: talk.mov\ntext')).problems)).toEqual([
      'bad_video',
    ]);
    expect(codes(checkCourse(COURSE('## M\n### L\nVideo: \ntext')).problems)).toEqual([
      'bad_video',
    ]);
    expect(
      codes(checkCourse(COURSE('## M\n### L\nVideo: a.mp4\nPoster: a.png\ntext')).problems),
    ).toEqual(['bad_poster']);
    expect(
      checkCourse(COURSE('## M\n### L\nPoster: a.jpg\ntext')).problems.map((p) => [p.code, p.line]),
    ).toEqual([['poster_without_video', 7]]);
    expect(
      codes(checkCourse(COURSE('## M\n### L\nVideo: a.mp4\nVideo: b.mp4\ntext')).problems),
    ).toEqual(['duplicate_line']);
  });

  it('the files: missing, over 50 MiB, not phone-playable — and a good clip is annotated', () => {
    const { course } = checkCourse(
      COURSE(
        '## M\n### A\nVideo: a.mp4\nPoster: a.jpg\ntext\n### B\nVideo: big.mp4\ntext\n### C\nVideo: gone.mp4\ntext\n### D\nVideo: hevc.mp4\ntext',
      ),
    );
    const sizes: Record<string, number> = {
      [resolve('/c', 'a.mp4')]: 40_000_000,
      [resolve('/c', 'a.jpg')]: 90_000,
      [resolve('/c', 'big.mp4')]: LIMIT_BYTES + 1,
      [resolve('/c', 'hevc.mp4')]: 1_000,
    };
    const facts = (codec: string): ProbeFacts => ({
      durationSeconds: 449.6,
      sizeBytes: 1,
      video: { codec, profile: '', pixFmt: 'yuv420p', width: 1280, height: 720 },
      audio: { codec: 'aac', channels: 2 },
    });
    const out = checkCourseMedia(course, {
      baseDir: '/c',
      sizeOf: (f) => sizes[f] ?? null,
      probe: (f) => facts(f.endsWith('hevc.mp4') ? 'hevc' : 'h264'),
    });
    expect(out.problems.map((p) => [p.code, p.line])).toEqual([
      ['video_too_large', 11],
      ['video_missing', 14],
      ['video_not_playable', 17],
    ]);
    expect(out.notes).toEqual([]);
    expect(course.modules[0]?.lessons[0]?.video).toMatchObject({
      file: resolve('/c', 'a.mp4'),
      bytes: 40_000_000,
      durationSeconds: 449.6,
    });
    expect(course.modules[0]?.lessons[0]?.poster).toMatchObject({ bytes: 90_000 });
  });

  it('without ffprobe, the clips are checked for size only, and the check SAYS so', () => {
    const { course } = checkCourse(COURSE('## M\n### A\nVideo: a.mp4\ntext'));
    const out = checkCourseMedia(course, { baseDir: '/c', sizeOf: () => 10, probe: null });
    expect(out.problems).toEqual([]);
    expect(out.clips).toBe(1);
    expect(out.notes[0]).toMatch(/ffprobe is not on PATH/u);
    expect(course.modules[0]?.lessons[0]?.video?.durationSeconds).toBeNull();
  });
});
