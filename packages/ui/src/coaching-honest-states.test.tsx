import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { AnalysisScreen } from './AnalysisScreen';
import { CoachingFeedScreen } from './CoachingFeedScreen';

/**
 * FE-D16 — the honest states Coaching and Analysis were missing, and the AI label.
 *
 * - "Not available": no analysis can be made, and the screen says why rather than looking
 *   like an empty but working feed.
 * - "No findings returned": the real `read_analysis` sends `findings: []` for every analysis
 *   today (FE-CR-8). A completed analysis with nothing in it must say so, not show a blank page.
 * - Every row of AI-written text says it was written by an AI model.
 */

const noop = (): void => undefined;

const feed = {
  periodLabel: 'Your coaching',
  reviewedNote: '0 of 0 visits reviewed',
  seenFirstNote: 'You see it first.',
  rows: [],
  onOpen: noop,
  onReply: noop,
};

const row = {
  analysisId: 'a1',
  doctorName: 'Dr Asha Deshpande',
  whenLabel: '1 Oct',
  findings: [{ id: 'f1', workedWell: false, summary: 'Answer the cost objection sooner.' }],
  repliedLabel: null,
  statusNote: null,
};

describe('CoachingFeedScreen — not available', () => {
  it('says why no analysis can be made, instead of the empty card', async () => {
    await render(
      <CoachingFeedScreen
        {...feed}
        unavailable={{
          title: 'Coaching is not available yet',
          detail: 'Recording is off in this build.',
        }}
      />,
    );

    expect(screen.getByText('Coaching is not available yet')).toBeTruthy();
    expect(screen.getByText('Recording is off in this build.')).toBeTruthy();
    expect(screen.queryByText('Nothing has been reviewed yet')).toBeNull();
  });

  it('POSITIVE CONTROL: with nothing unavailable, the empty feed is the empty card', async () => {
    await render(<CoachingFeedScreen {...feed} />);

    expect(screen.getByText('Nothing has been reviewed yet')).toBeTruthy();
    expect(screen.queryByText('Coaching is not available yet')).toBeNull();
  });
});

describe('CoachingFeedScreen — AI-written text says so', () => {
  it('every row with findings carries "Written by an AI model"', async () => {
    await render(<CoachingFeedScreen {...feed} rows={[row, { ...row, analysisId: 'a2' }]} />);

    expect(screen.getAllByText('Written by an AI model, not by a person')).toHaveLength(2);
  });
});

const analysisProps = {
  doctorName: 'Dr Asha Deshpande',
  whenLabel: '1 Oct',
  consentLabel: null,
  findings: [],
  audioNote: 'No recording.',
  onReply: noop,
  provenanceNote: 'Written by an AI model from the transcript, not by a person.',
};

describe('AnalysisScreen — a completed analysis with no findings', () => {
  it('says no findings were returned, rather than showing a blank analysis', async () => {
    await render(
      <AnalysisScreen
        {...analysisProps}
        noFindingsNote="The server returned this analysis with no findings."
      />,
    );

    expect(screen.getByText('No findings were returned')).toBeTruthy();
    expect(screen.getByText('The server returned this analysis with no findings.')).toBeTruthy();
  });

  it('POSITIVE CONTROL: no note, no banner', async () => {
    await render(<AnalysisScreen {...analysisProps} />);

    expect(screen.queryByText('No findings were returned')).toBeNull();
  });
});
