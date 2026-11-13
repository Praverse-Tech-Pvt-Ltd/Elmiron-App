'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ADVERSE_EVENT_ADMIN_RPC, AdverseEventReadSchema } from '@fieldforce/core';
import type { AdverseEventDetail } from '@fieldforce/core';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote, Pill } from './ui';
import { btn } from './theme-css';
import { indiaDateTime } from './india-date';
import {
  adverseRefusal,
  deadline,
  reporterLabel,
  sourceLabel,
  visitDayLabel,
} from './adverse-events-text';

/**
 * `FE-W204` — one side-effect flag, read only after the admin says why.
 *
 * `read_adverse_event` requires a reason and writes it to the audit log before it looks for the
 * flag, so the reason is the admin's own words, typed here — never a constant. The answer is held
 * in this component's state and nowhere else: the rep's words may carry patient information, so
 * they are not put in the page's server render, the address bar or any cache.
 *
 * A flag that is not in the caller's company comes back as nothing at all, exactly like one that
 * does not exist; the screen says it was not found, and cannot say more.
 */

type State =
  | { readonly kind: 'asking' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'shown'; readonly flag: AdverseEventDetail; readonly readAt: string };

const REASON_MIN = 3;

const Fact = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="ff-cell-stack">
    <Label>{label}</Label>
    <span>{children}</span>
  </div>
);

const Flag = ({ flag, readAt }: { readonly flag: AdverseEventDetail; readonly readAt: string }) => {
  const due = deadline(flag);
  return (
    <>
      <Card>
        <Heading>Deadline</Heading>
        <div className="ff-row">
          {due.overdue ? <Pill tone="critical">Overdue</Pill> : null}
          <span className="ff-strong">{due.when}</span>
          {due.left === null ? null : <span className="ff-muted">{due.left}</span>}
        </div>
        <Body muted>
          Fifteen days from when the server received the flag, {indiaDateTime(flag.receivedAt)}.
        </Body>
      </Card>
      <Card>
        <Heading>What was reported</Heading>
        {flag.reportedText === null ? (
          <Body muted>
            {flag.source === 'transcript_detected'
              ? 'The transcript check flagged a passage of the visit’s redacted transcript. It records where, not what was said, and makes no judgement about it.'
              : 'No words were recorded with this flag.'}
          </Body>
        ) : (
          <div className="ff-well ff-quote">
            <Body>
              <span className="ff-prewrap">{flag.reportedText}</span>
            </Body>
          </div>
        )}
      </Card>
      <Card>
        <Heading>About the flag</Heading>
        <div className="ff-stats ff-stats-2">
          <Fact label="Source">{sourceLabel(flag.source)}</Fact>
          <Fact label="Flagged by">{reporterLabel(flag)}</Fact>
          <Fact label="Doctor">{flag.doctorName}</Fact>
          <Fact label="Visit">{visitDayLabel(flag.visitDate)}</Fact>
          <Fact label="Received by the server">{indiaDateTime(flag.receivedAt)}</Fact>
          <Fact label="The phone’s own time">
            {flag.clientReportedAt === null ? 'Not sent' : indiaDateTime(flag.clientReportedAt)}
          </Fact>
        </div>
        <Label>Read at {indiaDateTime(readAt)}; your reason is in the audit log.</Label>
      </Card>
    </>
  );
};

export const AdverseEventReader = ({ eventId }: { readonly eventId: string }): ReactNode => {
  const [reason, setReason] = useState('');
  const [state, setState] = useState<State>({ kind: 'asking' });

  const read = (): void => {
    setState({ kind: 'busy' });
    void browserClient()
      .rpc(ADVERSE_EVENT_ADMIN_RPC.read, { p_id: eventId, p_reason: reason.trim() })
      .then(({ data, error }) => {
        if (error !== null) {
          setState({ kind: 'refused', message: adverseRefusal(error) });
          return;
        }
        const parsed = AdverseEventReadSchema.safeParse(data);
        if (!parsed.success) {
          setState({
            kind: 'refused',
            message:
              'The flag came back in a shape this console does not recognise, so it is not shown.',
          });
          return;
        }
        setState(
          parsed.data.data === null
            ? { kind: 'missing' }
            : { kind: 'shown', flag: parsed.data.data, readAt: parsed.data.readAt },
        );
      });
  };

  if (state.kind === 'shown') return <Flag flag={state.flag} readAt={state.readAt} />;
  if (state.kind === 'missing') {
    return (
      <MissingNote tone="info">
        No side-effect flag with this reference is in your company.{' '}
        <a href="/adverse-events">Back to side-effect flags</a>
      </MissingNote>
    );
  }

  return (
    <Card>
      <Heading>Why are you opening this flag?</Heading>
      <Body muted>
        What the rep reported may include details about a patient. Your reason is kept in the audit
        log with this read.
      </Body>
      <label className="ff-label" htmlFor="flag-reason">
        Reason
      </label>
      <input
        id="flag-reason"
        onChange={(e) => {
          setReason(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && reason.trim().length >= REASON_MIN) read();
        }}
        placeholder="For example: passing it to the safety team"
        value={reason}
      />
      <button
        className={btn('primary')}
        disabled={state.kind === 'busy' || reason.trim().length < REASON_MIN}
        onClick={read}
        type="button"
      >
        {state.kind === 'busy' ? 'Opening…' : 'Show the flag'}
      </button>
      {state.kind === 'refused' ? <MissingNote tone="critical">{state.message}</MissingNote> : null}
    </Card>
  );
};
