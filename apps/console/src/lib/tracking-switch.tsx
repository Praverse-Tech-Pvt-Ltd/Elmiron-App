'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { LIVE_TRACKING_RPC, TrackingSwitchResultSchema } from '@fieldforce/core';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote } from './ui';
import { trackingRefusal } from './tracking-text';
import { btn } from './theme-css';

/**
 * `FE-W72` — the company switch for live location, the client half of `/tracking`. Admin only: the
 * page draws this for an admin, and `set_live_tracking_enabled` refuses anybody else whatever is
 * drawn. A reason is required and kept with the change; the change itself is an audited row.
 *
 * `FE-W165`: "on" and "off" in sentence case, and the built-in draft called that.
 */
type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

export const TrackingSwitch = ({
  enabled,
  noticeIsDraft,
}: {
  readonly enabled: boolean;
  readonly noticeIsDraft: boolean;
}): ReactNode => {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const ready = reason.trim().length >= 3 && outcome.kind !== 'busy';

  const change = (): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(LIVE_TRACKING_RPC.setEnabled, { p_enabled: !enabled, p_reason: reason })
      .then(({ data, error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: trackingRefusal(error) });
          return;
        }
        const result = TrackingSwitchResultSchema.parse(data);
        setOutcome({
          kind: 'done',
          message: result.enabled ? 'Live location is now on.' : 'Live location is now off.',
        });
        setReason('');
        router.refresh();
      });
  };

  return (
    <Card>
      <Heading>Company switch</Heading>
      <Body>
        Live location is <strong>{enabled ? 'on' : 'off'}</strong> for your company.{' '}
        {enabled
          ? 'Reps who have accepted the notice and started sharing for the day send their position during working hours while the app is open.'
          : 'No rep’s position is kept, whatever their phone does.'}
      </Body>
      {!enabled && noticeIsDraft ? (
        <MissingNote>
          Your reps would be shown the built-in draft notice, marked as a draft, because your
          company has not loaded and approved its own. Approve your own notice before switching this
          on for real use.
        </MissingNote>
      ) : null}
      <Label>Why are you changing it? (kept with the change)</Label>
      <input
        aria-label="Reason"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
      />
      <div>
        <button
          className={btn(enabled ? 'danger' : 'primary')}
          disabled={!ready}
          type="button"
          onClick={change}
        >
          {outcome.kind === 'busy'
            ? 'Saving…'
            : enabled
              ? 'Switch live location off'
              : 'Switch live location on'}
        </button>
      </div>
      {outcome.kind === 'done' ? <MissingNote tone="info">{outcome.message}</MissingNote> : null}
      {outcome.kind === 'refused' ? (
        <MissingNote tone="critical">{outcome.message}</MissingNote>
      ) : null}
    </Card>
  );
};
