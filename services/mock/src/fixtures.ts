import type {
  Analysis,
  AnalysisOverride,
  BeatPlan,
  CallReport,
  CheckIn,
  CheckOut,
  ConsentRecord,
  ConsentTextVersion,
  Doctor,
  Recording,
  SampleAndInput,
  SyncQueueItem,
  Territory,
  Transcript,
  UploadSession,
  UserProfile,
  Visit,
  VoiceNote,
} from '@elmiron/core';

/**
 * Fixture data for the mock server.
 *
 * Everything here is typed as the real entity from `@elmiron/core`, so the mock
 * cannot drift from the contract without failing typecheck. That is the point: a
 * mock that hand-rolls its own shapes is a second contract nobody maintains.
 *
 * The world is a small West-India territory: one manager, two MRs, two doctors.
 * It is the same shape as the Gate 0 fixture world in services/api/tests, so a
 * screen built against the mock recognises real data when the API arrives.
 */

const T = (hour: number, minute = 0): string =>
  `2026-08-10T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`;

export const IDS = {
  orgTerritory: '11111111-1111-4111-8111-111111111101',
  westTerritory: '11111111-1111-4111-8111-111111111102',
  puneTerritory: '11111111-1111-4111-8111-111111111103',
  manager: '22222222-2222-4222-8222-222222222201',
  mr: '22222222-2222-4222-8222-222222222202',
  peerMr: '22222222-2222-4222-8222-222222222203',
  doctorA: '33333333-3333-4333-8333-333333333301',
  doctorB: '33333333-3333-4333-8333-333333333302',
  clinicA: '44444444-4444-4444-8444-444444444401',
  clinicB: '44444444-4444-4444-8444-444444444402',
  beatPlan: '55555555-5555-4555-8555-555555555501',
  visitDone: '66666666-6666-4666-8666-666666666601',
  visitDeclined: '66666666-6666-4666-8666-666666666602',
  visitInProgress: '66666666-6666-4666-8666-666666666603',
  checkIn: '77777777-7777-4777-8777-777777777701',
  checkOut: '77777777-7777-4777-8777-777777777702',
  callReport: '88888888-8888-4888-8888-888888888801',
  sample: '99999999-9999-4999-8999-999999999901',
  consentTextEn: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
  consentTextHi: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',
  consentGranted: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
  consentDeclined: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',
  consentNotAsked: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03',
  consentWithdrawal: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04',
  voiceNote: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
  recording: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
  transcript: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
  analysis: 'ffffffff-ffff-4fff-8fff-ffffffffff01',
  analysisRefused: 'ffffffff-ffff-4fff-8fff-ffffffffff02',
  finding: '12121212-1212-4212-8212-121212121201',
  override: '13131313-1313-4313-8313-131313131301',
  uploadSession: '14141414-1414-4414-8414-141414141401',
  queuedVisit: '15151515-1515-4515-8515-151515151501',
  queuedCheckIn: '15151515-1515-4515-8515-151515151502',
  queuedConsent: '15151515-1515-4515-8515-151515151503',
} as const;

export const profile: UserProfile = {
  id: IDS.mr,
  fullName: 'Ananya Deshpande',
  email: 'ananya.deshpande@example.test',
  role: 'mr',
  territoryId: IDS.puneTerritory,
  reportingManagerId: IDS.manager,
  isActive: true,
  createdAt: T(9),
  updatedAt: T(9),
};

export const territories: Territory[] = [
  {
    id: IDS.orgTerritory,
    name: 'National',
    code: 'IN',
    parentId: null,
    createdAt: T(9),
    updatedAt: T(9),
  },
  {
    id: IDS.westTerritory,
    name: 'West',
    code: 'IN-WEST',
    parentId: IDS.orgTerritory,
    createdAt: T(9),
    updatedAt: T(9),
  },
  {
    id: IDS.puneTerritory,
    name: 'Pune',
    code: 'IN-WEST-PUNE',
    parentId: IDS.westTerritory,
    createdAt: T(9),
    updatedAt: T(9),
  },
];

export const doctors: Doctor[] = [
  {
    id: IDS.doctorA,
    fullName: 'Dr Rohini Kulkarni',
    registrationNumber: 'MMC-2011-48213',
    specialty: 'Urology',
    qualification: 'MBBS, MS (Gen Surg), MCh (Urology)',
    territoryId: IDS.puneTerritory,
    assignedMrId: IDS.mr,
    clinicAddresses: [
      {
        id: IDS.clinicA,
        doctorId: IDS.doctorA,
        label: 'Sahyadri Clinic',
        line1: '204 Karve Road',
        line2: 'Above Deccan Chemists',
        city: 'Pune',
        state: 'Maharashtra',
        postalCode: '411004',
        coordinates: {
          latitude: 18.5074,
          longitude: 73.8077,
          accuracyMetres: 12,
          capturedAt: T(9, 30),
        },
        geofenceRadiusMetres: 150,
      },
    ],
    isActive: true,
    createdAt: T(9),
    updatedAt: T(9),
  },
  {
    id: IDS.doctorB,
    fullName: 'Dr Imran Shaikh',
    registrationNumber: 'MMC-2016-77104',
    specialty: 'Nephrology',
    qualification: 'MBBS, MD (Medicine), DM (Nephrology)',
    territoryId: IDS.puneTerritory,
    assignedMrId: IDS.mr,
    clinicAddresses: [
      {
        id: IDS.clinicB,
        doctorId: IDS.doctorB,
        label: 'Koregaon Park Polyclinic',
        line1: 'Lane 6, Koregaon Park',
        line2: null,
        city: 'Pune',
        state: 'Maharashtra',
        postalCode: '411001',
        coordinates: null,
        geofenceRadiusMetres: 200,
      },
    ],
    isActive: true,
    createdAt: T(9),
    updatedAt: T(9),
  },
];

export const beatPlans: BeatPlan[] = [
  {
    id: IDS.beatPlan,
    mrId: IDS.mr,
    territoryId: IDS.puneTerritory,
    planDate: '2026-08-10',
    status: 'approved',
    approvedByUserId: IDS.manager,
    approvedAt: T(8, 45),
    entries: [
      {
        id: '55555555-5555-4555-8555-555555555511',
        beatPlanId: IDS.beatPlan,
        doctorId: IDS.doctorA,
        clinicAddressId: IDS.clinicA,
        plannedSequence: 0,
      },
      {
        id: '55555555-5555-4555-8555-555555555512',
        beatPlanId: IDS.beatPlan,
        doctorId: IDS.doctorB,
        clinicAddressId: IDS.clinicB,
        plannedSequence: 1,
      },
    ],
    createdAt: T(8),
    updatedAt: T(8, 45),
  },
];

export const visits: Visit[] = [
  {
    id: IDS.visitDone,
    mrId: IDS.mr,
    doctorId: IDS.doctorA,
    beatPlanId: IDS.beatPlan,
    clinicAddressId: IDS.clinicA,
    status: 'completed',
    scheduledFor: T(10),
    startedAt: T(10, 4),
    completedAt: T(10, 21),
    createdAt: T(8),
    updatedAt: T(10, 21),
  },
  {
    // The declined-consent visit. It is a normal, complete, unremarkable visit.
    id: IDS.visitDeclined,
    mrId: IDS.mr,
    doctorId: IDS.doctorB,
    beatPlanId: IDS.beatPlan,
    clinicAddressId: IDS.clinicB,
    status: 'completed',
    scheduledFor: T(11, 30),
    startedAt: T(11, 34),
    completedAt: T(11, 49),
    createdAt: T(8),
    updatedAt: T(11, 49),
  },
  {
    id: IDS.visitInProgress,
    mrId: IDS.mr,
    doctorId: IDS.doctorA,
    beatPlanId: null,
    clinicAddressId: IDS.clinicA,
    status: 'in_progress',
    scheduledFor: null,
    startedAt: T(15, 2),
    completedAt: null,
    createdAt: T(15, 2),
    updatedAt: T(15, 2),
  },
];

export const checkIns: CheckIn[] = [
  {
    id: IDS.checkIn,
    visitId: IDS.visitDone,
    mrId: IDS.mr,
    coordinates: {
      latitude: 18.5075,
      longitude: 73.8079,
      accuracyMetres: 18,
      capturedAt: T(10, 4),
    },
    geofenceStatus: 'inside',
    distanceFromClinicMetres: 24,
    source: 'automatic',
    occurredAt: T(10, 4),
    createdAt: T(10, 4),
  },
];

export const checkOuts: CheckOut[] = [
  {
    id: IDS.checkOut,
    visitId: IDS.visitDone,
    mrId: IDS.mr,
    coordinates: {
      latitude: 18.5076,
      longitude: 73.808,
      accuracyMetres: 22,
      capturedAt: T(10, 21),
    },
    geofenceStatus: 'outside',
    distanceFromClinicMetres: 180,
    source: 'automatic',
    occurredAt: T(10, 21),
    createdAt: T(10, 21),
  },
];

export const callReports: CallReport[] = [
  {
    id: IDS.callReport,
    visitId: IDS.visitDone,
    mrId: IDS.mr,
    summary:
      'Reviewed the interstitial cystitis positioning. Dr Kulkarni raised the cost objection for a 6-month course; agreed to share the patient assistance leaflet.',
    productIdsDiscussed: ['31313131-3131-4131-8131-313131313101'],
    objectionsRaised: 'Cost of a six-month course.',
    nextStep: 'Send the patient assistance leaflet by Wednesday.',
    status: 'submitted',
    draftSource: 'voice_note',
    approvedByUserId: null,
    approvedAt: null,
    createdAt: T(10, 25),
    updatedAt: T(10, 26),
  },
];

export const samplesAndInputs: SampleAndInput[] = [
  {
    id: IDS.sample,
    visitId: IDS.visitDone,
    mrId: IDS.mr,
    doctorId: IDS.doctorA,
    kind: 'sample',
    itemName: 'Elmiron 100mg (blister x10)',
    quantity: 4,
    declaredValueInr: 0,
    occurredAt: T(10, 18),
    createdAt: T(10, 18),
  },
];

export const consentTextVersions: ConsentTextVersion[] = [
  {
    id: IDS.consentTextEn,
    versionLabel: 'v1.2',
    language: 'en-IN',
    fullText:
      'I agree that this conversation may be audio recorded so that the representative can be coached on how they present product information. The recording is deleted after 90 days. I can decline, or withdraw later, and nothing changes for me either way.',
    hash: 'a'.repeat(64),
    effectiveFrom: '2026-07-01T00:00:00+05:30',
    effectiveUntil: null,
    createdAt: '2026-07-01T00:00:00+05:30',
  },
  {
    id: IDS.consentTextHi,
    versionLabel: 'v1.2',
    language: 'hi-IN',
    fullText:
      'मैं सहमत हूँ कि इस बातचीत की ऑडियो रिकॉर्डिंग की जा सकती है ताकि प्रतिनिधि को प्रशिक्षण दिया जा सके। रिकॉर्डिंग 90 दिनों के बाद हटा दी जाती है। मैं मना कर सकता/सकती हूँ या बाद में सहमति वापस ले सकता/सकती हूँ।',
    hash: 'b'.repeat(64),
    effectiveFrom: '2026-07-01T00:00:00+05:30',
    effectiveUntil: null,
    createdAt: '2026-07-01T00:00:00+05:30',
  },
];

/**
 * All three outcomes, plus a withdrawal. Frontend needs every one of these on
 * screen at some point, and `declined` is not an error fixture — it is one of the
 * three ordinary ways a visit completes.
 */
export const consentRecords: ConsentRecord[] = [
  {
    id: IDS.consentGranted,
    visitId: IDS.visitDone,
    doctorId: IDS.doctorA,
    capturedByMrId: IDS.mr,
    outcome: 'consented',
    notAskedReason: null,
    consentTextVersionId: IDS.consentTextEn,
    displayedLanguage: 'en-IN',
    supersedesConsentRecordId: null,
    isWithdrawal: false,
    capturedAt: T(10, 5),
    createdAt: T(10, 5),
  },
  {
    id: IDS.consentDeclined,
    visitId: IDS.visitDeclined,
    doctorId: IDS.doctorB,
    capturedByMrId: IDS.mr,
    outcome: 'declined',
    notAskedReason: null,
    consentTextVersionId: IDS.consentTextHi,
    displayedLanguage: 'hi-IN',
    supersedesConsentRecordId: null,
    isWithdrawal: false,
    capturedAt: T(11, 35),
    createdAt: T(11, 35),
  },
  {
    id: IDS.consentNotAsked,
    visitId: IDS.visitInProgress,
    doctorId: IDS.doctorA,
    capturedByMrId: IDS.mr,
    outcome: 'not_asked',
    notAskedReason: 'Doctor was called into an emergency mid-conversation.',
    consentTextVersionId: IDS.consentTextEn,
    displayedLanguage: 'en-IN',
    supersedesConsentRecordId: null,
    isWithdrawal: false,
    capturedAt: T(15, 4),
    createdAt: T(15, 4),
  },
  {
    id: IDS.consentWithdrawal,
    visitId: IDS.visitDone,
    doctorId: IDS.doctorA,
    capturedByMrId: IDS.mr,
    outcome: 'declined',
    notAskedReason: null,
    consentTextVersionId: IDS.consentTextEn,
    displayedLanguage: 'en-IN',
    supersedesConsentRecordId: IDS.consentGranted,
    isWithdrawal: true,
    capturedAt: T(16, 40),
    createdAt: T(16, 40),
  },
];

export const voiceNotes: VoiceNote[] = [
  {
    id: IDS.voiceNote,
    visitId: IDS.visitDone,
    mrId: IDS.mr,
    storageKey: 'voice-notes/2026/08/10/66666601.opus',
    durationSeconds: 47.5,
    uploadStatus: 'uploaded',
    recordedAt: T(10, 23),
    createdAt: T(10, 23),
  },
];

export const recordings: Recording[] = [
  {
    id: IDS.recording,
    visitId: IDS.visitDone,
    mrId: IDS.mr,
    consentRecordId: IDS.consentGranted,
    storageKey: 'recordings/2026/08/10/66666601.opus',
    durationSeconds: 1012,
    codec: 'opus',
    bitrateKbps: 28,
    uploadStatus: 'uploaded',
    recordedAt: T(10, 5),
    purgeAfter: '2026-11-08T10:05:00+05:30',
    purgedAt: null,
    createdAt: T(10, 5),
  },
];

export const transcripts: Transcript[] = [
  {
    id: IDS.transcript,
    sourceType: 'recording',
    sourceId: IDS.recording,
    visitId: IDS.visitDone,
    language: 'hi-IN',
    redactionStatus: 'redacted',
    redactedAt: T(10, 40),
    segments: [
      {
        id: '16161616-1616-4616-8616-161616161601',
        speakerLabel: 'speaker_0',
        startMs: 0,
        endMs: 8400,
        text: 'Good morning doctor, thank you for the time. Main aaj Elmiron ke baare mein baat karna chahti hoon.',
      },
      {
        id: '16161616-1616-4616-8616-161616161602',
        speakerLabel: 'speaker_1',
        startMs: 8400,
        endMs: 21000,
        text: 'Haan bataiye. Cost kya hai six month course ka?',
      },
      {
        id: '16161616-1616-4616-8616-161616161603',
        speakerLabel: 'speaker_0',
        startMs: 21000,
        endMs: 34500,
        text: 'Main aapko exact figure baad mein bhej doongi. Patient assistance programme bhi available hai.',
      },
    ],
    vendor: 'sarvam',
    modelVersion: 'saarika:v2',
    createdAt: T(10, 38),
  },
];

export const analyses: Analysis[] = [
  {
    id: IDS.analysis,
    visitId: IDS.visitDone,
    mrId: IDS.mr,
    transcriptId: IDS.transcript,
    status: 'completed',
    refusalReason: null,
    rubricVersion: 'coaching-rubric-2026-08',
    modelProvider: 'gemini',
    modelVersion: 'flash-3',
    findings: [
      {
        id: IDS.finding,
        analysisId: IDS.analysis,
        category: 'objection_handling',
        severity: 'improvement',
        title: 'The cost objection was deferred rather than addressed',
        detail:
          'The doctor asked directly about the six-month course cost. The reply postponed the figure to a later message instead of giving it or explaining the assistance programme in the moment.',
        citations: [
          {
            transcriptId: IDS.transcript,
            segmentId: '16161616-1616-4616-8616-161616161603',
            startMs: 21000,
            endMs: 34500,
            quotedText: 'Main aapko exact figure baad mein bhej doongi.',
          },
        ],
        createdAt: T(10, 52),
      },
    ],
    mrViewedAt: T(12, 10),
    mrResponse: null,
    mrRespondedAt: null,
    generatedAt: T(10, 52),
    createdAt: T(10, 45),
  },
  {
    // Refusal is a first-class outcome, not an error. The UI has to render it.
    id: IDS.analysisRefused,
    visitId: IDS.visitDeclined,
    mrId: IDS.mr,
    transcriptId: IDS.transcript,
    status: 'refused',
    refusalReason:
      'No recording exists for this visit — consent was declined. There is nothing to assess and no finding can be cited.',
    rubricVersion: 'coaching-rubric-2026-08',
    modelProvider: 'gemini',
    modelVersion: 'flash-3',
    findings: [],
    mrViewedAt: null,
    mrResponse: null,
    mrRespondedAt: null,
    generatedAt: T(12, 2),
    createdAt: T(12, 1),
  },
];

export const analysisOverrides: AnalysisOverride[] = [
  {
    id: IDS.override,
    analysisId: IDS.analysis,
    findingId: IDS.finding,
    overriddenByUserId: IDS.manager,
    reason:
      'The doctor was between patients and asked for the figure by message. Deferring was the right call here.',
    createdAt: T(14, 15),
  },
];

export const uploadSession: UploadSession = {
  uploadSessionId: IDS.uploadSession,
  uploadUrl: 'http://127.0.0.1:54331/mock-storage/upload/14141414',
  storageKey: 'recordings/2026/08/10/66666601.opus',
  expiresAt: '2026-08-10T18:00:00+05:30',
  uploadedBytes: 1_048_576,
  totalBytes: 3_512_320,
};

/**
 * The offline-sync scenario: a full day queued on a device that never had signal.
 * One item already synced, one in flight, one in conflict, one hard-failed.
 */
export const syncQueue: SyncQueueItem[] = [
  {
    id: IDS.queuedVisit,
    entity: 'visit',
    operation: 'create',
    entityId: IDS.visitInProgress,
    payload: { doctorId: IDS.doctorA, status: 'in_progress', startedAt: T(15, 2) },
    status: 'queued',
    attemptCount: 0,
    lastError: null,
    clientCreatedAt: T(15, 2),
    syncedAt: null,
  },
  {
    id: IDS.queuedCheckIn,
    entity: 'check_in',
    operation: 'create',
    entityId: '77777777-7777-4777-8777-777777777703',
    payload: { visitId: IDS.visitInProgress, latitude: 18.5075, longitude: 73.8079 },
    status: 'in_flight',
    attemptCount: 2,
    lastError: null,
    clientCreatedAt: T(15, 3),
    syncedAt: null,
  },
  {
    id: IDS.queuedConsent,
    entity: 'consent_record',
    operation: 'create',
    entityId: IDS.consentNotAsked,
    payload: { visitId: IDS.visitInProgress, outcome: 'not_asked' },
    status: 'conflict',
    attemptCount: 5,
    lastError: 'A consent record already exists for this visit with a different outcome.',
    clientCreatedAt: T(15, 4),
    syncedAt: null,
  },
  {
    id: '15151515-1515-4515-8515-151515151504',
    entity: 'call_report',
    operation: 'update',
    entityId: IDS.callReport,
    payload: { summary: 'Updated after the follow-up call.' },
    status: 'failed',
    attemptCount: 9,
    lastError: 'Network unreachable for 6 hours; giving up until the next manual retry.',
    clientCreatedAt: T(16, 10),
    syncedAt: null,
  },
];
