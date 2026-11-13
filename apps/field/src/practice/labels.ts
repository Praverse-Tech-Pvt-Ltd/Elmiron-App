import { t } from '@fieldforce/ui/i18n';
import type { TextKey } from '@fieldforce/ui/i18n';

/**
 * `FE-W193` — how the practice screens name a practice doctor.
 *
 * **The stance** is the catalogue's word for the server's value, with a capital: it is a label after
 * a dot ("Urology · Sceptical"), and in lower case it read as a fragment of a sentence that was never
 * written. A value the app does not know is shown as the server sent it, never dropped.
 */
const STANCE: Readonly<Record<string, TextKey>> = {
  receptive: 'practice.stanceReceptive',
  sceptical: 'practice.stanceSceptical',
  rushed: 'practice.stanceRushed',
  hostile: 'practice.stanceHostile',
};

export const stanceWord = (stance: string): string => {
  const key = STANCE[stance];
  return key === undefined ? stance : t(key);
};

/**
 * **The name** without the " (practice)" the company's persona names carry. Every place the name is
 * shown already says what it is — "Practice simulation", "AI practice", "AI practice doctor" — so the
 * tag only doubled it ("Cost-conscious GP (practice), AI practice doctor · turn 2") in raw server
 * text. A name that is nothing but the tag is left as it is.
 */
const PRACTICE_TAG = /\s*\(practice\)\s*$/iu;

export const practiceDoctorName = (displayName: string): string => {
  const name = displayName.replace(PRACTICE_TAG, '').trim();
  return name === '' ? displayName : name;
};
