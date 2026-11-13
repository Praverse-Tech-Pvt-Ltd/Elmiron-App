/** Types for `BE-W209`'s clip trimmer (the pure parts its tests and the course loader import). */

export declare const LIMIT_BYTES: number;
export declare const TARGET_BYTES: number;
export declare const MUX_MARGIN: number;
export declare const MAX_ATTEMPTS: number;
export declare const RUNGS: readonly { height: number; minKbps: number; maxKbps: number }[];

export declare const parseTimestamp: (text: string) => number | null;
export declare const formatDuration: (seconds: number) => string;

export interface TrimArgs {
  help: boolean;
  input: string | null;
  out: string | null;
  poster: string | null;
  from: number | null;
  to: number | null;
  duration: number | null;
  problems: string[];
}
export declare const parseTrimArgs: (argv: string[]) => TrimArgs;

export interface EncodePlan {
  height: number;
  videoKbps: number;
  audioKbps: number;
  maxrateKbps: number;
  bufsizeKbps: number;
  expectedBytes: number;
}
export type PlanResult = ({ ok: true } & EncodePlan) | { ok: false; reason: string };

export declare const maxFittingSeconds: (targetBytes?: number) => number;
export declare const planEncode: (durationSeconds: number, targetBytes?: number) => PlanResult;
export declare const nextPlan: (
  previous: EncodePlan,
  actualBytes: number,
  durationSeconds: number,
  targetBytes?: number,
) => PlanResult;

export declare const ffmpegArgs: (input: {
  input: string;
  from: number;
  duration: number;
  out: string;
  plan: EncodePlan;
}) => string[];
export declare const posterArgs: (input: {
  clip: string;
  duration: number;
  poster: string;
}) => string[];

export declare const findTool: (
  name: 'ffmpeg' | 'ffprobe',
  env?: Record<string, string | undefined>,
  exists?: (path: string) => boolean,
) => string | null;
export declare const missingToolMessage: (name: string) => string;

export interface ProbeFacts {
  durationSeconds: number | null;
  sizeBytes: number | null;
  video: { codec: string; profile: string; pixFmt: string; width: number; height: number } | null;
  audio: { codec: string; channels: number } | null;
}
export declare const describeProbe: (json: unknown) => ProbeFacts;
export declare const playabilityProblems: (facts: ProbeFacts) => string[];
export declare const probeFile: (ffprobe: string, file: string) => ProbeFacts;
