/**
 * Types for the UCPMP cap decision deadline.
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
  daysRemaining: number | null;
  question: string;
}

export interface DecisionDebtVerdict {
  clear: boolean;
  reasons: string[];
}

export declare const evaluateDecisionDebt: (
  status: (Partial<CapDecisionStatus> & Record<string, unknown>) | null,
) => DecisionDebtVerdict;

export declare const checkDecisionDebt: (overrides?: {
  dbUrl?: string;
}) => Promise<DecisionDebtVerdict & { status: CapDecisionStatus | null }>;
