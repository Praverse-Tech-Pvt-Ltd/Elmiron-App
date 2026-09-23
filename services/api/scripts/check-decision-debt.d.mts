/**
 * Types for the UCPMP cap decision deadline, and since MR-52 D4 the BE-W106 one beside it.
 *
 * `evaluateDecisionDebt` is pure and exported separately from the database call for the
 * same reason `evaluatePurgeHealth` is: the failure path has to be provable without
 * waiting for the deadline to arrive. A control whose alarm nobody has ever seen fire is
 * indistinguishable from one that cannot.
 */

export interface CapDecisionStatus {
  capConfigured: boolean;
  dueAt: string | null;
  overdue: boolean;
  /** Mutually exclusive with `overdue`: a warning still true on the day the build goes red teaches a reader to ignore the red. */
  warn: boolean;
  warnFromAt: string | null;
  warnDays: number;
  daysRemaining: number | null;
  question: string;
}

export interface DecisionDebtVerdict {
  clear: boolean;
  reasons: string[];
  /** Printed, never fatal. `clear` alone decides the exit code. */
  warnings: string[];
}

export declare const evaluateDecisionDebt: (
  status: (Partial<CapDecisionStatus> & Record<string, unknown>) | null,
) => DecisionDebtVerdict;

/** MR-52 D4 — the settings-model decision (`BE-W106`), carried by the same step. */
export interface SettingsModelStatus {
  /** True once `app_thresholds` carries organisation scoping — read from the schema, not a flag. */
  settingsScoped: boolean;
  dueAt: string | null;
  overdue: boolean;
  warn: boolean;
  daysRemaining: number | null;
}

export declare const evaluateSettingsModelDebt: (
  status: (Partial<SettingsModelStatus> & Record<string, unknown>) | null,
) => DecisionDebtVerdict;

/**
 * MR-53 E3 — one unanswered decision, with the advice that belongs to IT.
 *
 * The two debts share a step and a deadline shape, and for fifteen days in October 2026 they are
 * both inside their warning windows at once. Printing one debt's question against the other's
 * warning is advice that looks like a control while pointing somewhere else.
 */
export interface DecisionDebt extends DecisionDebtVerdict {
  key: 'ucpmpCap' | 'settingsModel';
  /** Names the debt in the annotation title and the heading, so two warnings are two subjects. */
  label: string;
  /** Printed on both paths: what somebody has to answer. */
  question: string;
  /** Printed only when the build goes red: what is true until it is answered. */
  consequence: string;
}

export interface AllDecisionDebt extends DecisionDebtVerdict {
  debts: DecisionDebt[];
}

export declare const evaluateAllDecisionDebt: (
  capStatus: (Partial<CapDecisionStatus> & Record<string, unknown>) | null,
  settingsStatus: (Partial<SettingsModelStatus> & Record<string, unknown>) | null,
) => AllDecisionDebt;

export declare const checkDecisionDebt: (overrides?: { dbUrl?: string }) => Promise<
  AllDecisionDebt & {
    status: CapDecisionStatus | null;
    settingsStatus: SettingsModelStatus | null;
  }
>;
