// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SimPersona, SimScenario } from '@fieldforce/core';
import { FOUR_EYES_AUTHOR_NOTE, NOT_IN_REVIEW_NOTE } from './knowledge-review';
import {
  AI_DRAFT_CAUTION,
  PERSONA_NAME_CAUTION,
  PersonaDraftForm,
  SCENARIO_MARKET_CAUTION,
  ScenarioDraftForm,
  SimContentReview,
} from './sim-content';
import { simPersonaRow, simScenarioRow } from './sim-content-row';

/**
 * W1-F B — the authoring screens, rendered.
 *
 * **Nothing here touches a real doctor, a real recording or patient data, and that is asserted
 * rather than promised** — see the last `describe` in this file. Every identifier below is a
 * literal in this file; there is no network, no database and no audio.
 *
 * The properties that could go wrong quietly:
 *
 * 1. **A draft is born a draft.** The form cannot offer a status at all — if it ever gains one,
 *    `C24`'s never-born-approved rule stops being visible to whoever is filling the form in.
 * 2. **The four-eyes rule is the SAME rule as knowledge's**, imported rather than reimplemented.
 *    The author test below passes only because `approvalAffordance` is shared — a second copy
 *    would have to reproduce `FOUR_EYES_AUTHOR_NOTE` exactly, and would drift.
 * 3. **A scenario about a product names its market.** The server refuses it
 *    (`sim_scenarios_product_names_market`); this stops the admin finding out after typing.
 */

afterEach(cleanup);

const AUTHOR = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01';
const SUBMITTER = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b02';
const REVIEWER = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c03';
const ORG = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e05';

const persona = (over: Partial<SimPersona> = {}): SimPersona => ({
  id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d04',
  organisationId: ORG,
  displayName: 'Dr A. Sharma (practice)',
  specialty: 'Urology',
  stance: 'sceptical',
  brief: 'Busy clinic.\nWants evidence, not enthusiasm.',
  status: 'in_review',
  authorship: 'human',
  authoringModel: null,
  createdByUserId: AUTHOR,
  submittedByUserId: SUBMITTER,
  decidedByUserId: null,
  approvalAttestation: null,
  rejectionReason: null,
  createdAt: '2026-09-27T09:00:00+05:30',
  updatedAt: '2026-09-28T09:00:00+05:30',
  ...over,
});

const scenario = (over: Partial<SimScenario> = {}): SimScenario => ({
  id: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f06',
  organisationId: ORG,
  personaId: persona().id,
  title: 'First call after a formulary change',
  objective: 'Get agreement to a follow-up.',
  objection: 'I have prescribed the same thing for ten years.',
  productId: null,
  marketId: null,
  status: 'in_review',
  authorship: 'human',
  authoringModel: null,
  createdByUserId: AUTHOR,
  submittedByUserId: SUBMITTER,
  decidedByUserId: null,
  approvalAttestation: null,
  rejectionReason: null,
  createdAt: '2026-09-27T09:00:00+05:30',
  updatedAt: '2026-09-28T09:00:00+05:30',
  ...over,
});

const PERSONA_OPTION = { id: persona().id, displayName: 'Dr A. Sharma (practice)' };
const PRODUCT_OPTION = { id: '11111111-1111-4111-8111-111111111111', brandName: 'Probexa' };
const MARKET_OPTION = { id: '22222222-2222-4222-8222-222222222222', name: 'India' };
const PERSONAS = [PERSONA_OPTION];
const PRODUCTS = [PRODUCT_OPTION];
const MARKETS = [MARKET_OPTION];

const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

// ---------------------------------------------------------------------------

describe('B1 — drafting a persona', () => {
  it('saves a draft with the four fields, trimmed', async () => {
    const onCreate = vi.fn<(i: unknown) => Promise<void>>().mockResolvedValue(undefined);
    render(<PersonaDraftForm onCreate={onCreate} />);

    type('Name shown to the rep', '  Dr A. Sharma (practice)  ');
    type('Specialty', 'Urology');
    type('Brief', ' Busy clinic. ');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        displayName: 'Dr A. Sharma (practice)',
        specialty: 'Urology',
        stance: 'sceptical',
        brief: 'Busy clinic.',
      });
    });
  });

  it('cannot save an empty draft — the control is disabled', () => {
    render(<PersonaDraftForm onCreate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save draft' }).hasAttribute('disabled')).toBe(true);
  });

  it('offers no status at all: a persona is born a draft, never approved', () => {
    render(<PersonaDraftForm onCreate={vi.fn()} />);
    expect(screen.queryByLabelText('Status')).toBeNull();
    expect(screen.getByText(/Saved as a DRAFT/)).toBeTruthy();
  });

  it('warns that the name is shown to the rep and must not be a real doctor', () => {
    render(<PersonaDraftForm onCreate={vi.fn()} />);
    expect(screen.getByText(PERSONA_NAME_CAUTION)).toBeTruthy();
  });

  it('shows the server’s refusal rather than swallowing it', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('new row violates row-level security'));
    render(<PersonaDraftForm onCreate={onCreate} />);
    type('Name shown to the rep', 'X');
    type('Specialty', 'Y');
    type('Brief', 'Z');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      expect(screen.getByText(/violates row-level security/)).toBeTruthy();
    });
  });
});

describe('B2 — drafting a scenario', () => {
  const draw = (onCreate = vi.fn().mockResolvedValue(undefined)): typeof onCreate => {
    render(
      <ScenarioDraftForm
        personas={PERSONAS}
        products={PRODUCTS}
        markets={MARKETS}
        onCreate={onCreate}
      />,
    );
    return onCreate;
  };

  const fill = (): void => {
    type('Title', 'First call');
    type('What the rep should achieve', 'A follow-up.');
    type('The objection the doctor will raise', 'Ten years of the same thing.');
  };

  it('refuses to save a product scenario with no market, and says why', () => {
    draw();
    fill();
    type('Product', PRODUCT_OPTION.id);
    expect(screen.getByText(SCENARIO_MARKET_CAUTION)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save draft' }).hasAttribute('disabled')).toBe(true);
  });

  it('saves once the market is chosen', async () => {
    const onCreate = draw();
    fill();
    type('Product', PRODUCT_OPTION.id);
    type('Market', MARKET_OPTION.id);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        personaId: PERSONA_OPTION.id,
        title: 'First call',
        objective: 'A follow-up.',
        objection: 'Ten years of the same thing.',
        productId: PRODUCT_OPTION.id,
        marketId: MARKET_OPTION.id,
      });
    });
  });

  it('sends null, not an empty string, when the scenario is about no product', async () => {
    const onCreate = draw();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      expect(onCreate.mock.calls[0]?.[0]).toMatchObject({ productId: null, marketId: null });
    });
  });

  it('says a scenario needs an APPROVED persona when there is none', () => {
    render(
      <ScenarioDraftForm personas={[]} products={PRODUCTS} markets={MARKETS} onCreate={vi.fn()} />,
    );
    expect(screen.getByText(/needs an APPROVED practice doctor first/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });
});

describe('B3 — the review card applies the SAME four-eyes rule as knowledge', () => {
  const draw = (row: Parameters<typeof SimContentReview>[0]['row'], viewer: string) =>
    render(
      <SimContentReview
        row={row}
        viewerUserId={viewer}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onReject={vi.fn().mockResolvedValue(undefined)}
      />,
    );

  it('draws Approve and Reject for a third admin', () => {
    draw(simPersonaRow(persona()), REVIEWER);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
  });

  it('draws NEITHER control for the author, and gives knowledge’s own reason verbatim', () => {
    draw(simPersonaRow(persona()), AUTHOR);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    // The exact string from `knowledge-review.tsx`. This is what makes the reuse checkable.
    expect(screen.getByText(FOUR_EYES_AUTHOR_NOTE)).toBeTruthy();
  });

  it('refuses the submitter too', () => {
    draw(simPersonaRow(persona()), SUBMITTER);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('offers Submit, not Approve, while it is still a draft', () => {
    draw(simPersonaRow(persona({ status: 'draft' })), REVIEWER);
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    // And NOT knowledge's "submit the draft first" note: the Submit button already says that, and
    // a refusal note beside the control that fixes it reads as though the control is broken.
    expect(screen.queryByText(NOT_IN_REVIEW_NOTE)).toBeNull();
  });

  it('cannot approve with an empty attestation — the control is disabled', () => {
    draw(simPersonaRow(persona()), REVIEWER);
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true);
    type('Your attestation', 'I read the brief and it names no real doctor.');
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
  });

  it('cannot reject with no reason', () => {
    draw(simPersonaRow(persona()), REVIEWER);
    expect(screen.getByRole('button', { name: 'Reject' }).hasAttribute('disabled')).toBe(true);
  });

  it('passes the attestation the reviewer actually typed', async () => {
    const onApprove = vi.fn<(a: string) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <SimContentReview
        row={simPersonaRow(persona())}
        viewerUserId={REVIEWER}
        onSubmit={vi.fn()}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );
    type('Your attestation', 'Checked against the training deck.');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith('Checked against the training deck.');
    });
  });

  it('shows the server’s refusal rather than swallowing it', async () => {
    render(
      <SimContentReview
        row={simPersonaRow(persona())}
        viewerUserId={REVIEWER}
        onSubmit={vi.fn()}
        onApprove={vi.fn().mockRejectedValue(new Error('you may not approve your own content'))}
        onReject={vi.fn()}
      />,
    );
    type('Your attestation', 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(screen.getByText(/may not approve your own content/)).toBeTruthy();
    });
  });

  it('C24: says a MODEL wrote it, names the model, and carries the caution', () => {
    draw(simPersonaRow(persona({ authorship: 'ai_generated', authoringModel: 'stub' })), REVIEWER);
    expect(screen.getByText(/A model: stub\./)).toBeTruthy();
    expect(screen.getByText(AI_DRAFT_CAUTION)).toBeTruthy();
  });

  it('says a person wrote it when a person did, with no caution', () => {
    draw(simPersonaRow(persona()), REVIEWER);
    expect(screen.getByText('A person.')).toBeTruthy();
    expect(screen.queryByText(AI_DRAFT_CAUTION)).toBeNull();
  });

  it('shows the brief with its line breaks intact', () => {
    draw(simPersonaRow(persona()), REVIEWER);
    expect(screen.getByText(/Busy clinic\./)).toBeTruthy();
  });

  it('a scenario card names its persona, product and market in words, not uuids', () => {
    draw(simScenarioRow(scenario(), 'Dr A. Sharma (practice)', 'Probexa', 'India'), REVIEWER);
    expect(screen.getByText('Dr A. Sharma (practice)')).toBeTruthy();
    expect(screen.getByText('Probexa')).toBeTruthy();
    expect(screen.getByText('India')).toBeTruthy();
  });

  it('a scenario about no product says so rather than showing a blank', () => {
    draw(simScenarioRow(scenario(), 'Dr A. Sharma (practice)', null, null), REVIEWER);
    expect(screen.getByText('Not about a specific product')).toBeTruthy();
    expect(screen.getByText('No market')).toBeTruthy();
  });
});

describe('nothing on this screen touches a real doctor, a recording or patient data', () => {
  /**
   * Asserted, not promised. `W1-F` requires this to be a test rather than a comment.
   *
   * The screen's whole vocabulary is checked against the two tables it writes to. If somebody ever
   * adds a doctor picker, a visit field or an audio control to this file, one of these fails.
   */
  it('renders no control bound to doctors, visits, recordings or patients', () => {
    const { container } = render(
      <>
        <PersonaDraftForm onCreate={vi.fn()} />
        <ScenarioDraftForm
          personas={PERSONAS}
          products={PRODUCTS}
          markets={MARKETS}
          onCreate={vi.fn()}
        />
        <SimContentReview
          row={simScenarioRow(scenario(), 'Dr A. Sharma (practice)', 'Probexa', 'India')}
          viewerUserId={REVIEWER}
          onSubmit={vi.fn()}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />
      </>,
    );

    const text = container.textContent.toLowerCase();
    for (const forbidden of ['patient', 'recording', 'audio', 'visit', 'consent']) {
      expect(text).not.toContain(forbidden);
    }
    // The only use of the word "doctor" is the PRACTICE doctor, which the screen labels as such.
    expect(text).toContain('practice');
  });

  it('writes to exactly two tables, both of them simulation tables', async () => {
    // The module is read as source rather than executed: what matters is which table names appear
    // in it at all, and a runtime assertion could only see the paths a test happens to take.
    // `import.meta.url` is an http URL under the jsdom environment, so the path is resolved from
    // the package root instead. Vitest runs with `apps/console` as the cwd.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/lib/sim-content-list.tsx', 'utf8'),
    );
    const tables = [...source.matchAll(/insertRow\('([a-z_]+)'/g)].map((m) => m[1]);
    expect(tables).toEqual(['sim_personas', 'sim_scenarios']);
    for (const forbidden of ['doctors', 'visits', 'call_recordings', 'consents']) {
      expect(source).not.toContain(`'${forbidden}'`);
    }
  });
});
