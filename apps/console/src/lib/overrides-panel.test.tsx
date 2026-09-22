// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ListAnalysisOverridesResponse } from '@fieldforce/core';
import { OVERRIDES_READ_REASON, OverridesPanel, loadOverrides } from './overrides-panel';

/**
 * `FE-W12`, MR-50 F2 — the check that blocked it: **a real render**. The register's verification
 * is "a console test asserts a previously-saved override renders; deleting the fetch fails it".
 * `@testing-library/react` over jsdom, dev-only (`C10`).
 */
afterEach(cleanup);

const ANALYSIS = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c01';

const saved: ListAnalysisOverridesResponse = {
  data: [
    {
      id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d01',
      analysisId: ANALYSIS,
      findingId: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e01',
      overriddenByUserId: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f01',
      reason: 'The doctor asked for the figure by message; deferring was right.',
      createdAt: '2026-09-22T06:15:00+00:00',
    },
  ],
  readAt: '2026-09-22T06:20:00+00:00',
  auditLogId: 41,
};

describe('FE-W12 — the overrides already logged render on the review screen', () => {
  it('renders a previously-saved override, fetched for THIS analysis', async () => {
    const listAnalysisOverrides = vi.fn(() => Promise.resolve(saved));
    render(<OverridesPanel result={await loadOverrides({ listAnalysisOverrides }, ANALYSIS)} />);

    // MR-51 B2: with the reason the server requires of an admin, so the read is not refused.
    expect(listAnalysisOverrides).toHaveBeenCalledWith({
      analysisId: ANALYSIS,
      reason: OVERRIDES_READ_REASON,
    });
    expect(screen.getByText('Overrides already logged (1)')).toBeTruthy();
    expect(
      screen.getByText('The doctor asked for the figure by message; deferring was right.'),
    ).toBeTruthy();
    expect(screen.getByText('2026-09-22 06:15 UTC · one finding')).toBeTruthy();
  });

  it('says the history could not be loaded when the read fails — never "none logged"', async () => {
    const listAnalysisOverrides = vi.fn(() => Promise.reject(new Error('network')));
    render(<OverridesPanel result={await loadOverrides({ listAnalysisOverrides }, ANALYSIS)} />);

    expect(screen.getByText(/could not be loaded/u)).toBeTruthy();
    expect(screen.queryByText('No override logged yet')).toBeNull();
  });

  it('says none is logged only when the server answered with none', async () => {
    const listAnalysisOverrides = vi.fn(() => Promise.resolve({ ...saved, data: [] }));
    render(<OverridesPanel result={await loadOverrides({ listAnalysisOverrides }, ANALYSIS)} />);

    expect(screen.getByText('No override logged yet')).toBeTruthy();
  });
});
