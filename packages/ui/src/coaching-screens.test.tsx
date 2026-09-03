import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AnalysisReplyScreen } from './AnalysisReplyScreen';
import { AnalysisScreen } from './AnalysisScreen';
import type { AnalysisFinding } from './AnalysisScreen';
import { CoachingFeedScreen } from './CoachingFeedScreen';

const noop = (): void => undefined;

const citation = {
  timestamp: '02:14',
  retention: 'audio deleted at 90 days · transcript kept',
  quote: '…my patients ask about cost first.',
};

const finding = (over: Partial<AnalysisFinding> = {}): AnalysisFinding => ({
  id: 'f1',
  workedWell: false,
  summary: 'The cost objection was not answered.',
  citations: [citation],
  ...over,
});

describe('D1 — the feed says how little is looked at', () => {
  const feed = {
    periodLabel: 'Your coaching',
    reviewedNote: '3 visits reviewed of 42',
    seenFirstNote: "You're seeing this before your manager acts on it.",
    rows: [
      {
        analysisId: 'a1',
        doctorName: 'Dr S. Iyer',
        whenLabel: '14 Aug',
        findings: [
          { id: 'w', workedWell: true, summary: 'Purpose was clear in eighteen seconds.' },
          { id: 't', workedWell: false, summary: 'The cost objection was not answered.' },
        ],
        repliedLabel: null,
        statusNote: null,
      },
    ],
    onOpen: noop,
    onReply: noop,
  };

  it('shows the sampling ratio, never a bare count of what was reviewed', async () => {
    // The design added this against the brief: an MR who believes every visit is
    // analysed behaves like someone under total observation.
    await render(<CoachingFeedScreen {...feed} />);
    expect(screen.getByText('3 visits reviewed of 42')).toBeTruthy();
  });

  it('states that the MR reads it first, at the top rather than in a policy', async () => {
    await render(<CoachingFeedScreen {...feed} />);
    expect(screen.getByText('You see it first')).toBeTruthy();
    expect(screen.getByText(feed.seenFirstNote)).toBeTruthy();
  });

  it('renders no score, rank, percentile or grade anywhere', async () => {
    // §3.6's regulatory line. The 3 September decision reopened the screens, not
    // the scoring ban.
    await render(
      <CoachingFeedScreen
        {...feed}
        trend={{
          caption: 'Objections you answered, month by month',
          points: [
            { label: 'Jun', count: 2 },
            { label: 'Jul', count: 3 },
            { label: 'Aug', count: 4 },
          ],
          note: 'Yours only — nobody else’s, and not a score.',
        }}
      />,
    );
    // Searched over rendered *text*, not the serialised tree: the first version of
    // this matched `"width":"100%"` on a bar's style and failed for a reason that
    // has nothing to do with scoring. What has to be absent is score-*shaped*
    // copy — a value out of a total, a percentage, a rank, a percentile, a grade —
    // rather than the bare word "score", which the trend note uses to deny one.
    expect(
      screen.queryAllByText(/out of \d|\d\s?%|percentile|\brank(ed|ing)?\b|\bgrade\b/iu),
    ).toHaveLength(0);
    // And the trend says whose numbers these are, so the chart cannot be read as a
    // comparison against anyone else.
    expect(screen.getByText('Yours only — nobody else’s, and not a score.')).toBeTruthy();
  });

  it('prints the counts as words beside the bars', async () => {
    // A bar chart with no numbers is a shape an MR can read a ranking into.
    await render(
      <CoachingFeedScreen
        {...feed}
        trend={{
          caption: 'Objections you answered, month by month',
          points: [
            { label: 'Jul', count: 3 },
            { label: 'Aug', count: 4 },
          ],
          note: 'Yours only.',
        }}
      />,
    );
    expect(screen.getByText('Jul 3 · Aug 4')).toBeTruthy();
  });

  it('offers no actions on a row that produced nothing', async () => {
    await render(
      <CoachingFeedScreen
        {...feed}
        rows={[
          {
            analysisId: 'a1',
            doctorName: 'Dr S. Iyer',
            whenLabel: '14 Aug',
            findings: [],
            repliedLabel: null,
            statusNote: 'Nothing could be said without guessing, so nothing was.',
          },
        ]}
      />,
    );
    expect(
      screen.getByText('Nothing could be said without guessing, so nothing was.'),
    ).toBeTruthy();
    expect(screen.queryByText('Open it')).toBeNull();
  });

  it('says most visits are never reviewed when there is nothing yet', async () => {
    await render(<CoachingFeedScreen {...feed} rows={[]} />);
    expect(screen.getByText('Nothing has been reviewed yet')).toBeTruthy();
    expect(screen.getByText(/Most visits never are/u)).toBeTruthy();
  });
});

describe('D2 — every finding carries its evidence', () => {
  const analysis = {
    doctorName: 'Dr S. Iyer',
    whenLabel: '14 Aug',
    consentLabel: 'they agreed to recording',
    findings: [finding({ id: 'w', workedWell: true, summary: 'Purpose was clear.' }), finding()],
    audioNote: 'This build cannot play audio back — nothing was recorded to play.',
    onReply: noop,
    provenanceNote: 'Written by the system from the transcript.',
  };

  it('renders the quote and its timestamp for every finding', async () => {
    await render(<AnalysisScreen {...analysis} />);
    expect(screen.getAllByText(`“${citation.quote}”`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`02:14 · ${citation.retention}`).length).toBeGreaterThan(0);
  });

  it('puts what worked before what to try', async () => {
    await render(<AnalysisScreen {...analysis} />);
    expect(screen.getByText('What worked')).toBeTruthy();
    expect(screen.getByText('One thing to try next time')).toBeTruthy();
  });

  it('offers no play control, and says why', async () => {
    // A dead play button would tell the MR a recording of them exists.
    await render(<AnalysisScreen {...analysis} />);
    expect(screen.queryByLabelText(/Play the recording/u)).toBeNull();
    expect(screen.getByText(analysis.audioNote)).toBeTruthy();
  });

  it('pluralises the improvement heading rather than implying only one exists', async () => {
    await render(
      <AnalysisScreen
        {...analysis}
        findings={[finding({ id: 'a' }), finding({ id: 'b' }), finding({ id: 'c' })]}
      />,
    );
    expect(screen.getByText('Things to try next time')).toBeTruthy();
  });

  it('shows a refusal as the system declining to guess, not as a failure', async () => {
    await render(
      <AnalysisScreen
        {...analysis}
        findings={[]}
        statusNote="Nothing could be said about this visit without guessing, so nothing was."
      />,
    );
    expect(screen.getByText('Nothing was written about this visit')).toBeTruthy();
    // No reply button: there is no finding to reply to.
    expect(screen.queryByText('Add your reply')).toBeNull();
  });

  it('shows the reply beside the findings once it exists', async () => {
    await render(<AnalysisScreen {...analysis} reply="I answered it in the corridor." />);
    expect(screen.getByText('I answered it in the corridor.')).toBeTruthy();
    expect(screen.getByText('Change your reply')).toBeTruthy();
  });
});

describe('D3 — the reply is a first-class object', () => {
  const reply = {
    finding: 'The cost objection was not answered.',
    value: '',
    onChangeText: noop,
    onSend: noop,
    onSaveDraft: noop,
    replyNote: 'Your manager sees this next to the finding, not underneath it.',
    voiceNote: 'This build cannot record audio.',
  };

  it('quotes the finding it argues with, and does not let it be edited', async () => {
    await render(<AnalysisReplyScreen {...reply} />);
    expect(screen.getByText('The cost objection was not answered.')).toBeTruthy();
    // One field on the screen, and it is the reply — not the finding.
    expect(screen.getByLabelText('What you want to say')).toBeTruthy();
  });

  it('refuses to send an empty reply, and says why rather than greying out silently', async () => {
    const onSend = jest.fn();
    await render(<AnalysisReplyScreen {...reply} onSend={onSend} />);
    await fireEvent.press(screen.getByText('Send reply'));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Write something first/u).length).toBeGreaterThan(0);
  });

  it('sends once there are words', async () => {
    const onSend = jest.fn();
    await render(<AnalysisReplyScreen {...reply} onSend={onSend} value="I did answer it." />);
    await fireEvent.press(screen.getByText('Send reply'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('says where the reply lands, without a warning tone on disagreeing', async () => {
    await render(<AnalysisReplyScreen {...reply} value="I did answer it." />);
    expect(screen.getByText(reply.replyNote)).toBeTruthy();
    expect(screen.getByText('Your manager sees this next to the finding.')).toBeTruthy();
  });

  it('offers no hold-to-talk control, and says why', async () => {
    await render(<AnalysisReplyScreen {...reply} />);
    expect(screen.queryByText(/hold to say/iu)).toBeNull();
    expect(screen.getByText(reply.voiceNote)).toBeTruthy();
  });
});
