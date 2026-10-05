/**
 * Types for W2-A A's check (`BE-C70`): the service-role key is read in exactly one place. Pure, so every
 * failure is provable on a modified copy of the files without touching the real ones.
 */

export interface SourceFile {
  path: string;
  text: string;
}

export declare const KEY_NAME: string;
export declare const WRITER_PATH: string;
export declare const WRITER_ALLOWED: string[];
export declare const stripComments: (text: string) => string;
export declare const checkServiceRoleReads: (
  functions: SourceFile[],
  core: SourceFile[],
) => string[];
export declare const loadRepository: () => { functions: SourceFile[]; core: SourceFile[] };
