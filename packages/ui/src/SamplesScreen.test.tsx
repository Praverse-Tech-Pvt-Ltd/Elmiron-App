import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SamplesScreen } from './SamplesScreen';
import type { SampleLine } from './SamplesScreen';

const line = (over: Partial<SampleLine> = {}): SampleLine => ({
  id: 'line-1',
  kind: 'sample',
  itemName: 'Elmiron 100 mg, 30s',
  quantity: 2,
  declaredValueInr: '240',
  ...over,
});

const noop = (): void => undefined;

const props = {
  doctorName: 'Dr. S. Iyer',
  dateLabel: '14 August',
  capNote: 'This app does not count your samples against the UCPMP cap.',
  onAddLine: noop,
  onChangeLine: noop,
  onRecord: noop,
  onRemoveLine: noop,
};

describe('the cap', () => {
  it('draws no meter when nothing has supplied one, and says so in words', async () => {
    // The file's central claim. A meter here would be a number this app invented
    // about a compliance limit, and an MR who believes the app is holding that line
    // stops holding it themselves.
    await render(<SamplesScreen {...props} lines={[line()]} />);
    expect(screen.getByText(props.capNote)).toBeTruthy();
    expect(screen.queryByText(/of 12 packs/u)).toBeNull();
  });

  it('draws the meter once a caller has a real ceiling to pass', async () => {
    await render(
      <SamplesScreen
        {...props}
        cap={{ used: 6, limit: 12, unitLabel: 'packs' }}
        lines={[line()]}
      />,
    );
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('of 12 packs')).toBeTruthy();
    // The note stays even with a meter — it is what says who enforces the limit.
    expect(screen.getByText(props.capNote)).toBeTruthy();
  });
});

describe('the declared value is asked for, never assumed', () => {
  it('gives the value its own field and says whose declaration it is', async () => {
    await render(<SamplesScreen {...props} lines={[line()]} />);
    expect(screen.getByLabelText('Declared value, ₹ each')).toBeTruthy();
    expect(screen.getByText(/goes on the record as your declaration/u)).toBeTruthy();
  });
});

describe('the stepper is the quantity control', () => {
  it('steps up and down through the caller rather than holding its own state', async () => {
    const onChangeLine = jest.fn();
    await render(
      <SamplesScreen {...props} lines={[line({ quantity: 2 })]} onChangeLine={onChangeLine} />,
    );

    await fireEvent.press(screen.getByLabelText('One more Packs'));
    expect(onChangeLine).toHaveBeenCalledWith('line-1', { quantity: 3 });

    await fireEvent.press(screen.getByLabelText('One fewer Packs'));
    expect(onChangeLine).toHaveBeenCalledWith('line-1', { quantity: 1 });
  });

  it('cannot be taken below one — a handover of nothing is not a handover', async () => {
    const onChangeLine = jest.fn();
    await render(
      <SamplesScreen {...props} lines={[line({ quantity: 1 })]} onChangeLine={onChangeLine} />,
    );
    await fireEvent.press(screen.getByLabelText('One fewer Packs'));
    expect(onChangeLine).not.toHaveBeenCalled();
  });
});

describe('lines', () => {
  it('offers no removal on the only line', async () => {
    // A screen with nothing on it has no purpose, and an MR who deleted their way
    // to it would have to know to press "Add another item" to get back.
    await render(<SamplesScreen {...props} lines={[line()]} />);
    expect(screen.queryByText('Remove this item')).toBeNull();
  });

  it('offers removal once there is more than one', async () => {
    await render(<SamplesScreen {...props} lines={[line(), line({ id: 'line-2' })]} />);
    expect(screen.getAllByText('Remove this item')).toHaveLength(2);
  });

  it("shows a refused line's reason against that line", async () => {
    await render(
      <SamplesScreen
        {...props}
        lines={[line({ error: 'Put the declared value of one pack in rupees.' })]}
      />,
    );
    expect(screen.getByText('Put the declared value of one pack in rupees.')).toBeTruthy();
  });
});

describe('the outcome is told as a completion, not as a fault', () => {
  it('reports work saved on the phone without a warning tone', async () => {
    await render(
      <SamplesScreen
        {...props}
        lines={[line()]}
        saved="2 saved on this phone. They will send by themselves when you have signal."
      />,
    );
    expect(screen.getByText('Recorded')).toBeTruthy();
  });

  it('replaces the whole screen with the failure when the load itself failed', async () => {
    await render(
      <SamplesScreen
        {...props}
        failure={{ title: 'Could not load this visit', detail: 'No answer from the server.' }}
        lines={[line()]}
      />,
    );
    expect(screen.getByText('Could not load this visit')).toBeTruthy();
    expect(screen.queryByText('Record what I left')).toBeNull();
  });
});

/** Every text on screen, in reading order. */
const textsInOrder = (): string[] => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node !== null && typeof node === 'object' && 'children' in node) {
      walk(node.children);
    }
  };
  walk(screen.toJSON());
  return out;
};

/**
 * **FE-D12 item 4.** The rep presses "Record what I left" at the foot of a long form. The
 * "Recorded" confirmation was drawn at the TOP, off-screen by then, so all they saw was the form
 * clearing. It belongs where they are looking: right beside the button they pressed.
 */
describe('the confirmation (FE-D12 item 4)', () => {
  it('sits right beside "Record what I left", after the form and the cap note', async () => {
    await render(
      <SamplesScreen {...props} lines={[line()]} saved="1 recorded against this visit." />,
    );
    const texts = textsInOrder();
    const recorded = texts.indexOf('Recorded');
    const button = texts.indexOf('Record what I left');
    const capNote = texts.indexOf(props.capNote);

    expect(recorded).toBeGreaterThan(capNote);
    expect(texts.slice(recorded, button)).toEqual(['Recorded', '1 recorded against this visit.']);
  });

  it('still says nothing when nothing has been recorded', async () => {
    await render(<SamplesScreen {...props} lines={[line()]} />);
    expect(screen.queryByText('Recorded')).toBeNull();
  });
});
