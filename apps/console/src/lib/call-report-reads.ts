import type { SignedIn } from './session';
import type { CallReportRow } from './manager-rows';
import type { ReportLookups, VisitFacts } from './call-reports-text';

/**
 * `FE-W200` / `FE-W201` — the names and dates beside a call report, read as the signed-in user.
 *
 * A report carries ids: the rep, the visit, the products. These four reads turn them into words,
 * each under the table's own RLS policy — `user_profiles_select_team`, `visits_select_own_or_team`,
 * `doctors_select_in_territory` (an admin: their company's), `products_select_own_organisation` —
 * so the console never sees a name the caller could not read in the app. A name that does not come
 * back is printed as unknown by `reportView`, never as an id.
 *
 * **What is NOT read**: anything about prescribing. Doctors are read for their name only.
 */
const unique = (values: readonly (string | null)[]): string[] => [
  ...new Set(values.filter((v): v is string => v !== null)),
];

export const reportLookups = async (
  db: SignedIn['db'],
  rows: readonly CallReportRow[],
): Promise<ReportLookups> => {
  const peopleIds = unique(rows.flatMap((r) => [r.mrId, r.decidedBy]));
  const visitIds = unique(rows.map((r) => r.visitId));
  const productIds = unique(rows.flatMap((r) => r.productIds));

  const [people, visits, products] = await Promise.all([
    peopleIds.length === 0
      ? null
      : db.from('user_profiles').select('id, full_name').in('id', peopleIds),
    visitIds.length === 0
      ? null
      : db
          .from('visits')
          .select('id, doctor_id, started_at, completed_at, scheduled_for')
          .in('id', visitIds),
    productIds.length === 0
      ? null
      : db.from('products').select('id, brand_name').in('id', productIds),
  ]);

  const visitMap = new Map<string, VisitFacts>();
  for (const v of (visits?.data ?? []) as {
    id: string;
    doctor_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    scheduled_for: string | null;
  }[]) {
    visitMap.set(v.id, {
      doctorId: v.doctor_id,
      startedAt: v.started_at,
      completedAt: v.completed_at,
      scheduledFor: v.scheduled_for,
    });
  }

  const doctorIds = unique([...visitMap.values()].map((v) => v.doctorId));
  const doctors =
    doctorIds.length === 0
      ? null
      : await db.from('doctors').select('id, full_name').in('id', doctorIds);

  const names = (data: unknown, label: string): Map<string, string> =>
    new Map(
      ((data ?? []) as Record<string, string>[]).map((row) => [row['id'] ?? '', row[label] ?? '']),
    );

  return {
    people: names(people?.data, 'full_name'),
    visits: visitMap,
    doctors: names(doctors?.data, 'full_name'),
    products: names(products?.data, 'brand_name'),
  };
};
