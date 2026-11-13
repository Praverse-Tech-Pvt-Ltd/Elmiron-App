import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * `FE-W190` — the call report the rep has typed and not yet sent, kept on this phone.
 *
 * The report lived only in the screen's state, so Back — to check a time on the visit, or by a
 * thumb on the gesture bar — threw away everything typed (QA 50), and the rep typed it again in a
 * corridor. Now each change is written here and read back when the report is opened again; it is
 * removed the moment the report is sent or saved to send, because from then on the outbox holds it.
 *
 * **Scoped to the signed-in rep AND the visit**, as `consent/witnessed.ts` is (`FE-W61`): another
 * rep signing in on this phone never sees it, and one visit's words never appear on another's.
 * It is a draft and nothing else: nothing here is sent, and the server never sees it.
 */
export interface ReportDraft {
  readonly summary: string;
  readonly objections: string;
  readonly nextStep: string;
  readonly productIds: readonly string[];
}

export const REPORT_DRAFT_KEY = (userId: string, visitId: string): string =>
  `report.draft.v1.${userId}.${visitId}`;

/** True when there is nothing in it worth keeping. */
export const isEmptyDraft = (draft: ReportDraft): boolean =>
  draft.summary.trim() === '' &&
  draft.objections.trim() === '' &&
  draft.nextStep.trim() === '' &&
  draft.productIds.length === 0;

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The draft for this rep and visit, or null. A draft that cannot be read is no draft. */
export const readReportDraft = async (
  userId: string | null,
  visitId: string,
): Promise<ReportDraft | null> => {
  if (userId === null) return null;
  try {
    const raw = await AsyncStorage.getItem(REPORT_DRAFT_KEY(userId, visitId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const draft: ReportDraft = {
      summary: text(parsed['summary']),
      objections: text(parsed['objections']),
      nextStep: text(parsed['nextStep']),
      productIds: strings(parsed['productIds']),
    };
    return isEmptyDraft(draft) ? null : draft;
  } catch {
    return null;
  }
};

/** Keep it, or — once it is empty again — forget it. A failed write loses nothing already sent. */
export const writeReportDraft = async (
  userId: string | null,
  visitId: string,
  draft: ReportDraft,
): Promise<void> => {
  if (userId === null) return;
  const key = REPORT_DRAFT_KEY(userId, visitId);
  try {
    if (isEmptyDraft(draft)) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // A draft is a convenience. The report itself is only ever in the outbox or on the server.
  }
};

/** The report was sent or saved to send: the outbox has it now. */
export const clearReportDraft = async (userId: string | null, visitId: string): Promise<void> => {
  if (userId === null) return;
  try {
    await AsyncStorage.removeItem(REPORT_DRAFT_KEY(userId, visitId));
  } catch {
    // Storage that cannot remove a key cannot be fixed from here. The words come back the next
    // time this report is opened, in front of the rep, who can see they were sent and clear them.
  }
};
