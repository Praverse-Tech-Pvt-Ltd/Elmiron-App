import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ConsentTextVersion } from '@fieldforce/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import { ConsentDetailsScreen, ConsentScreen, Screen } from '@fieldforce/ui';
import type { ConsentAnswer } from '@fieldforce/ui';
import { createPushClient } from '../../src/sync/push-client';
import { unavailableReason } from '../../src/capture/preconditions';
import { fetchActiveNotice, fetchConsentNotices } from '../../src/consent/notices';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
import type { PreconditionMessage } from '../../src/capture/preconditions';
import {
  CONSENT_VARIANT,
  consentCopy,
  consentDetails,
  fiduciaryNote,
  NEVER_COLLECTED,
} from '../../src/consent/content';
import {
  blockedReason,
  consentRequest,
  languageOptionsFrom,
  noticeLabelFor,
  offerableVersions,
} from '../../src/consent/record';
import { consentQueueItem, sendOrQueue } from '../../src/sync/outbox';

/**
 * Phase 3 — the handoff, as a route.
 *
 * **This screen is the only one in the app whose reader is not the MR.** Everything
 * about the binding follows from that:
 *
 * - **It fetches before it renders anything a doctor could answer.** The notice is
 *   what the record attests to, so until one is in hand there is no question to
 *   put. `blockedReason` turns that into a sentence for the MR instead of a screen
 *   with a Yes on it.
 * - **The answer is written before the phone comes back.** Both outcomes go through
 *   `sendOrQueue`, so a refusal recorded in a basement clinic survives to be sent
 *   later. A consent captured and then lost is the one failure this flow cannot
 *   have — it is the evidence that the doctor was asked at all.
 * - **Nothing is written when the phone is simply handed back.** That exit is not a
 *   decision and must not become one. `not_asked` exists in the ledger for a visit
 *   where the question was never put, and it takes a reason the MR gives later —
 *   writing it here would be the app answering on the doctor's behalf.
 *
 * **Neither the MR's name nor their organisation is known to this app**, and the
 * screen says so honestly rather than filling the gap. See the note on
 * `organisation` below, and **BE-W93** — registered by MR-24 as a COMPLIANCE item,
 * because a DPDP notice that identifies no fiduciary is a defect in the EVIDENCE a
 * consent record carries, not a weak sentence. The comment that stood here claimed
 * the opposite and survived a session in which it was already false.
 */
export default function ConsentRoute(): ReactNode {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const router = useRouter();

  /**
   * MR-23 B1. **Neither of these is known, and the screen already says so honestly.**
   *
   * The comment that stood here claimed *"the MR's own name and their organisation come
   * from the token"*. They do not: the JWT carries `app_role`, `app_territory_id`,
   * `app_is_active` and `email` — no name and no company. The name was coming from
   * `getMe()` against the MOCK, so the fiduciary line named a FIXTURE rep to a real doctor.
   *
   * `fiduciaryNote(null, firstName)` already falls back to *"your rep's employer is the
   * Data Fiduciary"*, and `askedBy` to *"Your rep"* — both true. Registered rather than
   * papered over: a DPDP fiduciary line that can name neither the company nor the person
   * is a copy gap somebody has to answer.
   */
  const organisation: string | null = null;
  const [versions, setVersions] = useState<readonly ConsentTextVersion[]>([]);
  const [language, setLanguage] = useState<string | null>(null);
  const [notice, setNotice] = useState<ConsentTextVersion | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * Whether the notice has been looked for yet.
   *
   * Without this the screen cannot tell "not fetched" from "nothing published",
   * and `blockedReason` answers the second question with the first one's data.
   */
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  /**
   * MR-23 B1. The visit and the doctor come from the store the pull maintains; the notices
   * come from Supabase under RLS.
   *
   * **The last of the three gating reads.** This screen fetched its versions from the mock
   * at `:4010`, so an MR standing in front of a doctor was shown a FIXTURE notice, and a
   * capture made against it would have named a version id Supabase does not hold —
   * `capture_consent` would have refused it `45001` after the doctor had already answered.
   */
  const { store, status, failure: pullFailure } = usePulledStore();
  const visit = visitsFromStore(store).find((candidate) => candidate.id === visitId) ?? null;
  const doctor =
    visit === null
      ? null
      : (doctorsFromStore(store).find((candidate) => candidate.id === visit.doctorId) ?? null);

  useEffect(() => {
    let cancelled = false;

    void fetchConsentNotices()
      .then((texts) => {
        if (cancelled) return;
        const live = offerableVersions(texts, new Date().toISOString());
        setVersions(live);
        // MR-22 B2. `offerableVersions` now sorts, so `live[0]` is a DETERMINISTIC default
        // rather than whatever order the server happened to return. What the screen shows
        // first is what the server will record as `displayed_language`, because it is
        // derived from the version this choice selects.
        setLanguage((current) => current ?? live[0]?.language ?? null);
        // No live version means there is nothing for the second effect to fetch,
        // so this is where the looking stops.
        if (live.length === 0) setSettled(true);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setSettled(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The active version is fetched per language rather than picked out of the list
  // already in hand. `getActiveConsentText` is the server's answer to "which one is
  // in force"; choosing on the device would make the record depend on how fresh the
  // list happened to be.
  useEffect(() => {
    if (language === null) return;
    let cancelled = false;

    void fetchActiveNotice(language)
      .then((version) => {
        if (!cancelled) setNotice(version);
      })
      .catch(() => {
        if (!cancelled) {
          setNotice(null);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setSettled(true);
      });

    return () => {
      cancelled = true;
    };
  }, [language]);

  // `mrName` is null by construction -- see the note above -- so this is the fallback
  // rather than a choice between two values.
  const firstName = 'your rep';
  const copy = consentCopy(firstName);

  // MR-20 B2. A channel for "this screen cannot act", separate from `blockedReason`, which
  // answers a different question -- whether the QUESTION may be put to the doctor at all.
  const [unavailable, setUnavailable] = useState<PreconditionMessage | null>(null);

  const answer = useCallback(
    (given: ConsentAnswer): void => {
      // `busy` stays silent: the screen already shows it. A missing visit or doctor does
      // not, and pressing Allow to no effect is the worst possible place for a tap that
      // does nothing -- the doctor has just been asked out loud.
      if (busy) return;
      const missing = unavailableReason(visit, doctor);
      if (missing !== null) {
        setUnavailable(missing);
        return;
      }
      if (visit === null || doctor === null || notice === null) return;
      setBusy(true);

      void (async () => {
        const body = consentRequest({
          id: uuid.v4(),
          visitId: visit.id,
          doctorId: doctor.id,
          answer: given,
          version: notice,
          capturedAt: new Date().toISOString(),
        });

        // Both outcomes take the same path. There is no faster route for a yes.
        await sendOrQueue(
          // MR-18 B1. Through `sync_push`, so `capture_consent` runs and the three
          // FIX-02/FIX-12 bounds apply on the offline path they exist for.
          () => createPushClient().createConsentRecord(body),
          consentQueueItem(body),
        );

        setBusy(false);
        // Straight back to the visit either way, and with no confirmation screen in
        // between: the doctor has answered and the phone is about to change hands.
        // A "thank you" here would be the app addressing the doctor after the
        // decision, which is the moment pressure is cheapest to apply.
        router.replace(`/visit/${visit.id}`);
      })();
    },
    [busy, doctor, notice, router, visit],
  );

  if (showDetails && notice !== null) {
    return (
      <Screen scrollable>
        <ConsentDetailsScreen
          collected={consentDetails(firstName)}
          fiduciaryNote={fiduciaryNote(organisation, firstName)}
          neverCollected={NEVER_COLLECTED}
          notice={notice.fullText}
          noticeLabel={noticeLabelFor(notice)}
          onBack={() => {
            setShowDetails(false);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      <ConsentScreen
        askedBy="Your rep"
        /*
          `unavailable` wins over `blockedReason`: if the screen cannot act at all, saying
          "there is no notice for this language" would be answering a question the MR is
          not yet able to reach.
        */
        blocked={
          unavailable ??
          (pullFailure !== null
            ? {
                title: 'Could not load this visit',
                detail: 'The app could not reach the server. It will try again.',
              }
            : settled
              ? blockedReason(notice, failed)
              : null)
        }
        busy={busy}
        loading={!settled || status === 'loading'}
        facts={copy.facts}
        ifAgree={copy.ifAgree}
        ifDecline={copy.ifDecline}
        notice={notice?.fullText ?? ''}
        noticeLabel={notice === null ? '' : noticeLabelFor(notice)}
        onAnswer={answer}
        onHandBack={() => {
          router.back();
        }}
        onChangeLanguage={setLanguage}
        onOpenDetails={() => {
          setShowDetails(true);
        }}
        question={copy.question}
        summary={copy.summary}
        variant={CONSENT_VARIANT}
        languages={languageOptionsFrom(versions)}
        {...(language === null ? {} : { language })}
      />
    </Screen>
  );
}
