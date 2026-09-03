import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConsentDetailsScreen } from './ConsentDetailsScreen';

const NOTICE = 'I agree that this conversation may be audio recorded.';

const props = {
  neverCollected:
    'Anything about your patients. Anything about what you prescribe. Video. Anything after the recording is stopped.',
  collected: [
    { title: 'Audio of this conversation', detail: 'Kept 90 days, then deleted.' },
    { title: 'Your name and clinic', detail: 'Already held as a business contact.' },
    { title: 'Date, time and duration' },
  ],
  notice: NOTICE,
  noticeLabel: 'Notice v1.2 · English · a1b2c3d4',
  fiduciaryNote: 'Elmiron India Pvt Ltd is the Data Fiduciary for this recording.',
  onBack: (): void => undefined,
};

describe('D3 — the legal layer', () => {
  it('leads with what is never collected, before anything that is', async () => {
    // The design's own ordering, and the opposite of how a privacy notice is
    // usually written: the unspoken fear is prescriber surveillance, so the answer
    // to it comes first.
    await render(<ConsentDetailsScreen {...props} />);
    const never = screen.getByText('Never collected');
    const first = screen.getByText('Audio of this conversation');
    expect(never).toBeTruthy();
    expect(first).toBeTruthy();
    expect(screen.getByText(props.neverCollected)).toBeTruthy();
  });

  it('lists an item with no detail without inventing one', async () => {
    await render(<ConsentDetailsScreen {...props} />);
    expect(screen.getByText('Date, time and duration')).toBeTruthy();
  });

  it('carries the attested text and the pair that makes a record checkable', async () => {
    // A version label can be reused; the hash cannot. Both are on screen because
    // together they are what lets an audit reconstruct what was agreed to.
    await render(<ConsentDetailsScreen {...props} />);
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.getByText('Notice v1.2 · English · a1b2c3d4')).toBeTruthy();
  });

  it('names the Data Fiduciary and where a complaint goes', async () => {
    await render(<ConsentDetailsScreen {...props} />);
    expect(screen.getByText(props.fiduciaryNote)).toBeTruthy();
  });

  it('returns to the question rather than answering it', async () => {
    // There is no Yes on this screen. A doctor who came to read the detail has not
    // yet been asked, and putting an answer here would let the legal layer double
    // as the decision.
    const onBack = jest.fn();
    await render(<ConsentDetailsScreen {...props} onBack={onBack} />);
    expect(screen.queryByText("Yes, that's fine")).toBeNull();
    await fireEvent.press(screen.getByText('Back to the question'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
