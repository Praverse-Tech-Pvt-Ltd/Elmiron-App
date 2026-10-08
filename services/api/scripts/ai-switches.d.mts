/** Types for W2-I B1's switches script. */
import type { Target } from './content-loader.mjs';

export interface SwitchCommand {
  verb: string;
  writes: { key: string; value: unknown }[];
}
export interface SwitchStatus {
  limit: unknown;
  features: { feature: string; on: boolean; approvedInstructions: boolean }[];
}
export declare const SWITCHABLE: string[];
export declare const parseSwitches: (words: string[]) => {
  command: SwitchCommand;
  problems: string[];
};
export declare const runSwitches: (
  command: SwitchCommand,
  target: Target & { note?: string },
) => Promise<SwitchStatus>;
export declare const describeStatus: (status: SwitchStatus) => string;
