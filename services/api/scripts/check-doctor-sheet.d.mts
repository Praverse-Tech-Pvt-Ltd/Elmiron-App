/**
 * Types for the doctors-and-clinics checker (`BE-W179`). Pure, so the suite proves every refusal
 * without a database.
 */
import type { ReferenceData } from './seed-reference-data.d.mts';

export declare const DOCTOR_COLUMNS: readonly string[];
export declare const DEFAULT_GEOFENCE_METRES: number;

export interface DoctorSheetError {
  sheet: string;
  row: number;
  code: string;
  detail: string;
}

export declare const checkDoctorSheet: (input: {
  doctorsCsv: string;
  reference: Pick<ReferenceData, 'organisations' | 'territories'> & Partial<ReferenceData>;
}) => {
  errors: DoctorSheetError[];
  notes: string[];
  reference: ReferenceData | null;
};
