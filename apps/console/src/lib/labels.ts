/**
 * `FE-W165` — the words a person reads in place of a database value.
 *
 * The console printed what the database stores: `insert ai_requests`, `(mr)`, `product_qa`,
 * `sceptical`, `Asia/Kolkata`, and the reason string a screen sends with its read. Each was right
 * for the machine and wrong for an admin. This file is the one place a stored value becomes a word,
 * so two screens showing the same row (`/audit` and the compliance panel on `/admin`) say the same
 * thing, and a value nobody has named yet still reads as words rather than as `snake_case`.
 *
 * **Nothing here changes what is stored or sent.** Filters still submit `user_profiles` and
 * `insert`; only the text beside them changes. Pure, so it is tested without a renderer and is safe
 * to call from a server or a client component.
 */

/** Short words that read wrongly when only the first letter is raised. */
const TOKENS: Readonly<Record<string, string>> = {
  ai: 'AI',
  id: 'ID',
  mr: 'rep',
  sim: 'practice',
  qa: 'questions',
};

/** `snake_case` as a sentence-case phrase: `objection_handling` -> "Objection handling". */
export const words = (value: string): string => {
  const phrase = value
    .split(/[_\s]+/u)
    .filter((w) => w !== '')
    .map((w) => TOKENS[w] ?? w)
    .join(' ');
  return phrase === '' ? value : `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;
};

/** The roles, as the rest of the console names people: never `mr` or `field_manager`. */
const ROLE_WORDS: Readonly<Record<string, string>> = {
  mr: 'Rep',
  field_manager: 'Manager',
  admin: 'Admin',
};

export const roleWord = (role: string | null): string | null =>
  role === null ? null : (ROLE_WORDS[role] ?? words(role));

/**
 * A person and their role, without saying the role twice. Seeded names often carry it already
 * ("Rep 1 (Pune)"), and "Rep 1 (Pune) (mr)" read as a fault.
 */
export const whoLabel = (name: string | null, role: string | null): string => {
  const word = roleWord(role);
  if (name === null || name.trim() === '') return word ?? 'Not recorded';
  if (word === null || name.toLowerCase().includes(word.toLowerCase())) return name;
  return `${name} · ${word}`;
};

/** What happened to a record, as a verb. `select` in particular is not a word a manager uses. */
const ACTION_WORDS: Readonly<Record<string, string>> = {
  select: 'Read',
  insert: 'Created',
  update: 'Changed',
  delete: 'Deleted',
};

export const actionLabel = (action: string): string => ACTION_WORDS[action] ?? words(action);

/**
 * The kinds of record the audit trail names, as nouns. A table this list does not know still reads
 * as words (`words()`), so a new table never shows up as `snake_case`.
 */
const TABLE_WORDS: Readonly<Record<string, string>> = {
  adverse_event_reports: 'Adverse event report',
  ai_prompt_versions: 'AI prompt',
  ai_requests: 'AI request',
  analyses: 'Coaching analysis',
  analysis_overrides: 'Override',
  app_thresholds: 'Setting',
  audio_destruction_log: 'Audio destruction',
  audit_log: 'Audit log',
  beat_plan_entries: 'Day plan stop',
  beat_plans: 'Day plan',
  call_report_approvals: 'Call report approval',
  call_reports: 'Call report',
  check_ins: 'Check-in',
  check_outs: 'Check-out',
  consent_records: 'Consent record',
  consent_text_versions: 'Consent notice version',
  course_assignments: 'Course assignment',
  course_enrolments: 'Course enrolment',
  course_modules: 'Course module',
  course_versions: 'Course version',
  courses: 'Course',
  device_push_tokens: 'Notification device',
  doctors: 'Doctor',
  knowledge_chunks: 'Knowledge passage',
  knowledge_document_versions: 'Knowledge version',
  knowledge_documents: 'Knowledge document',
  lesson_completions: 'Lesson completion',
  lessons: 'Lesson',
  live_tracking_acceptances: 'Live location acceptance',
  live_tracking_notice_approvals: 'Live location notice approval',
  live_tracking_notice_versions: 'Live location notice',
  location_pings: 'Location position',
  markets: 'Market',
  notification_outbox: 'Notification',
  organisations: 'Company',
  plan_reassignments: 'Visit moved to another rep',
  planning_territory_grant_revocations: 'Planning access revoked',
  planning_territory_grants: 'Planning access grant',
  product_markets: 'Product market',
  products: 'Product',
  recordings: 'Visit recording',
  sim_coach_analyses: 'Practice feedback',
  sim_personas: 'Practice doctor',
  sim_scenarios: 'Practice scenario',
  sim_sessions: 'Practice session',
  sim_turns: 'Practice turn',
  territories: 'Territory',
  therapy_areas: 'Therapy area',
  unplanned_visit_reviews: 'Unplanned visit review',
  user_profiles: 'User',
  user_provisioning: 'New user',
  visits: 'Visit',
  voice_notes: 'Voice note',
  work_day_reopenings: 'Reopened day',
  work_days: 'Working day',
  write_rejections: 'Refused write',
};

export const tableLabel = (table: string): string => TABLE_WORDS[table] ?? words(table);

/** One audit row's "what": "Created · AI request". The same words on `/audit` and on `/admin`. */
export const auditWhat = (action: string, table: string): string =>
  `${actionLabel(action)} · ${tableLabel(table)}`;

/**
 * The reasons this console sends with its own audited reads, in the words of the screen that was
 * opened. The stored reason is the screen's own constant (`READ_REASON` on each page, unchanged, so
 * the trail is unchanged); a reason a PERSON typed is never in this list and is shown verbatim.
 * `labels.test.ts` reads every page and fails when one sends a reason this list does not name.
 */
const CONSOLE_READ_REASONS: Readonly<Record<string, string>> = {
  'console admin screen — compliance panel render': 'Opened Consent versions',
  'console audit log screen': 'Opened the audit log',
  'console coaching queue — queue render': 'Opened the coaching queue',
  'console retention & purge screen': 'Opened Retention & purge',
  'console side-effect flags screen': 'Opened Side-effect flags',
  'console review screen — analysis opened for review': 'Opened an analysis to review it',
  'console review screen — override history render': 'Opened an analysis’s overrides',
  'console users & roles screen render': 'Opened Users & roles',
};

export const CONSOLE_READ_REASON_KEYS: readonly string[] = Object.keys(CONSOLE_READ_REASONS);

/** The reason to show, or null when none was given (a trigger's row, not a person's). */
export const reasonLabel = (reason: string | null): string | null =>
  reason === null || reason.trim() === '' ? null : (CONSOLE_READ_REASONS[reason] ?? reason);

/**
 * The AI features, with the names the field app gives them (`packages/ui/src/i18n/en.json`:
 * "Assistant", "Product questions", "AI Doctor practice"; the coach's output is "Practice feedback").
 */
const FEATURE_WORDS: Readonly<Record<string, string>> = {
  product_qa: 'Product questions',
  mr_chat: 'Assistant',
  lms_tutor: 'Lesson tutor',
  ai_doctor: 'AI Doctor practice',
  ai_coach: 'Practice feedback',
};

export const featureLabel = (feature: string): string => FEATURE_WORDS[feature] ?? words(feature);

/** How a practice doctor behaves (`SIM_PERSONA_STANCES`). */
const STANCE_WORDS: Readonly<Record<string, string>> = {
  receptive: 'Receptive',
  sceptical: 'Sceptical',
  rushed: 'In a hurry',
  hostile: 'Hostile',
};

export const stanceLabel = (stance: string): string => STANCE_WORDS[stance] ?? words(stance);

/** A practice content row's kind, in the practice screen's own words. */
export const contentKindLabel = (kind: 'persona' | 'scenario'): string =>
  kind === 'persona' ? 'Practice doctor' : 'Scenario';

/** A time zone as a person says it. Every territory today is in India; others keep their name. */
export const timeZoneLabel = (zone: string): string =>
  zone === 'Asia/Kolkata' || zone === 'Asia/Calcutta' ? 'India time (IST)' : zone;
