/** Types for `BE-W205`'s key-day script (the pure parts its tests import). */
import type { NetworkInterfaceInfo } from 'node:os';

export declare const REPO_ROOT: string;
export declare const MIGRATIONS_DIR: string;
export declare const FUNCTIONS_ENV: string;
export declare const STATE_FILE: string;
export declare const CONTENT_DIR: string;
export declare const DRAFTS_DIR: string;
export declare const NOTICE_DRAFT: string;
export declare const DEFAULT_ANON_KEY: string;
export declare const MARKER: string;
export declare const OUTPUT_SCHEMA: Record<string, string>;
export declare const PRACTICE_NOT_LOADED: Record<string, string>;

export declare const parseKeyDayArgs: (argv: string[]) => {
  fresh: boolean;
  help: boolean;
  problems: string[];
};

export interface FunctionsEnvFacts {
  exists: boolean;
  provider: string | null;
  openAiKey: 'absent' | 'placeholder' | 'present';
  aws: boolean;
  glued: boolean;
}
export declare const inspectFunctionsEnv: (text: string | null) => FunctionsEnvFacts;
export declare const describeFunctionsEnv: (env: FunctionsEnvFacts) => {
  live: boolean;
  lines: string[];
};

export declare const migrationGap: (
  files: string[],
  applied: string[],
) => { onDisk: number; applied: number; missing: string[]; unknown: string[] };

export declare const readDraftPrompt: (
  feature: string,
  file: string,
) => { text: string; modelConfig: Record<string, unknown> };

export declare const parsePracticeDrafts: (file: string) => {
  personas: {
    code: string;
    displayName: string;
    specialty: string;
    stance: string;
    brief: string;
  }[];
  scenarios: {
    code: string;
    persona: string;
    title: string;
    objective: string;
    objection: string;
  }[];
  skipped: { code: string; why: string }[];
};

export declare const testNoticeBody: (draft: string) => string;
export declare const refuseRemote: (targets: { label: string; url: string }[]) => void;
export declare const likelyLanAddress: (
  interfaces?: Record<string, NetworkInterfaceInfo[] | undefined>,
) => { name: string; address: string } | null;
