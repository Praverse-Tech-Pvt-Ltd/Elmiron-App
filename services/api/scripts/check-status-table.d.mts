/**
 * Types for W2-F C3's check (`BE-C75`): the last status table cites every operator must-have and keeps
 * the format's rules. Pure, so every failure is provable on a modified copy of the log.
 */

export interface MustHaves {
  statuses: string[];
  items: { key: string; item: string }[];
}

export declare const lastStatusTable: (log: string) => string[][] | null;
export declare const checkStatusTable: (log: string, mustHaves: MustHaves) => string[];
