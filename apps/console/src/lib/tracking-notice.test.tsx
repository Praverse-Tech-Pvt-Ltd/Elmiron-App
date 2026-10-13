// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CompanyNoticeVersion } from '@fieldforce/core';

/**
 * `FE-W91` — the notice screen's two client parts, rendered. The approvals trigger refuses the
 * author whatever is drawn; these assert the screen does not OFFER the author an Approve button,
 * offers it to a different admin only with what they checked written down, and shows a refusal in
 * the database's words with its remedy.
 */
const rpc = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./supabase', () => ({ browserClient: () => ({ rpc }) }));

const { NoticeVersionCard, ProposeNotice } = await import('./tracking-notice');

afterEach(() => {
  cleanup();
  rpc.mockReset();
});

const VERSION: CompanyNoticeVersion = {
  id: 'dd9ca1e9-c2c4-42f6-bf6a-4d24895a36e9',
  versionLabel: 'v1',
  body: 'The company notice text, line one.\nLine two.',
  createdAt: '2026-10-13T07:10:15.70199+00:00',
  authorName: 'Asha Admin',
  authoredByYou: false,
  status: 'waiting',
  approvedAt: null,
  approverName: null,
  attestation: null,
};

describe('FE-W91 — approving a notice version', () => {
  it('the author is told to wait for a second admin, and has no Approve button', () => {
    render(<NoticeVersionCard version={{ ...VERSION, authoredByYou: true }} />);
    expect(screen.getByText(/Waiting for a second admin — ask/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/u })).toBeNull();
    expect(screen.getByText(/Loaded by you/u)).toBeTruthy();
  });

  it('another admin approves only after saying what they checked, and is told reps re-accept', async () => {
    rpc.mockResolvedValue({ data: 'id', error: null });
    render(<NoticeVersionCard version={VERSION} />);
    expect(screen.getByText(/every rep must read and accept it again/u)).toBeTruthy();
    const approve = screen.getByRole<HTMLButtonElement>('button', { name: 'Approve v1' });
    expect(approve.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What you checked in v1'), {
      target: { value: 'Read against the HR policy' },
    });
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => {
      expect(screen.getByText(/is now in force; every rep must accept it again/u)).toBeTruthy();
    });
    expect(rpc).toHaveBeenCalledWith('approve_live_tracking_notice', {
      p_notice_version_id: VERSION.id,
      p_attestation: 'Read against the HR policy',
    });
  });

  it('a refusal is shown in plain words with its remedy', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'the author of a notice may not approve it' },
    });
    render(<NoticeVersionCard version={VERSION} />);
    fireEvent.change(screen.getByLabelText('What you checked in v1'), {
      target: { value: 'checked' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve v1' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Ask a second admin to approve it/u);
    });
  });

  it('an approved version offers nothing to approve', () => {
    render(
      <NoticeVersionCard
        version={{
          ...VERSION,
          status: 'in_force',
          approvedAt: '2026-10-13T08:00:00+00:00',
          approverName: 'Bina Admin',
          attestation: 'read',
        }}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Approved by Bina Admin/u)).toBeTruthy();
  });
});

describe('FE-W91 — loading a version', () => {
  it('stays disabled until there is a label and a full text, then sends both', async () => {
    rpc.mockResolvedValue({ data: 'new-id', error: null });
    render(<ProposeNotice />);
    const load = screen.getByRole<HTMLButtonElement>('button', { name: 'Load this version' });
    expect(load.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Version label'), { target: { value: ' v2 ' } });
    fireEvent.change(screen.getByLabelText('Notice text'), { target: { value: 'too short' } });
    expect(load.disabled).toBe(true);
    const text = 'Location sharing during working hours. '.repeat(3);
    fireEvent.change(screen.getByLabelText('Notice text'), { target: { value: text } });
    expect(load.disabled).toBe(false);
    fireEvent.click(load);
    await waitFor(() => {
      expect(
        screen.getByText(/not shown to anybody until a second admin approves it/u),
      ).toBeTruthy();
    });
    expect(rpc).toHaveBeenCalledWith('propose_live_tracking_notice', {
      p_version_label: 'v2',
      p_body: text.trim(),
    });
  });

  it('a label used before is refused in words', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "live_tracking_notice_label_once"',
      },
    });
    render(<ProposeNotice />);
    fireEvent.change(screen.getByLabelText('Version label'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByLabelText('Notice text'), {
      target: { value: 'x'.repeat(60) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load this version' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/different label/u);
    });
  });

  it('warns about a [[ BLANK ]] left from the draft', () => {
    render(<ProposeNotice />);
    fireEvent.change(screen.getByLabelText('Notice text'), {
      target: { value: 'From: [[ BLANK: registered legal name ]]' },
    });
    expect(screen.getByText(/still has a \[\[ BLANK \]\]/u)).toBeTruthy();
  });
});
