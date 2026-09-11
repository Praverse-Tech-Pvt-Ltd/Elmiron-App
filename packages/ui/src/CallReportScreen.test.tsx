import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { CallReportScreen } from './CallReportScreen';

/**
 * MR-25 D1 — the outcome banner must not claim the server has work it does not have.
 *
 * **Found on the emulator with no signal.** A report saved offline rendered:
 *
 * > **Report sent**
 * > Saved on this phone. It will send by itself when you have signal — you do not have to
 * > retype it.
 *
 * The two halves of one banner contradicting each other, with the heading making the claim a
 * reader takes away. The title was hardcoded `"Report sent"` and the detail came from the
 * caller, so the queued branch could only ever change half of it.
 *
 * MR-18 B3 rewrote this screen's copy for exactly this reason — so it would stop claiming the
 * server had taken something it had not. It fixed the detail. Nobody re-read the title.
 *
 * These cases are two-sided on purpose: asserting only that the queued banner says "saved"
 * would pass against a title hardcoded to "Report saved", which would then lie in the other
 * direction about work the server really does have.
 */

const noop = (): void => undefined;

const props = {
  doctorName: 'Dr. S. Iyer',
  dateLabel: '11 Sep',
  summary: 'Discussed dosing.',
  onSummaryChange: noop,
  nextStep: '',
  onNextStepChange: noop,
  objections: '',
  onObjectionsChange: noop,
  onSend: noop,
};

describe('the call-report outcome banner', () => {
  it('says SENT only when the server has taken it', async () => {
    await render(
      <CallReportScreen
        {...props}
        sentNote={{
          title: 'Report sent',
          detail: 'Your manager sees this next time they open your visits.',
        }}
      />,
    );
    expect(screen.getByText('Report sent')).toBeTruthy();
    expect(screen.queryByText(/saved on this phone/i)).toBeNull();
  });

  it('says SAVED when it is only on the phone, and never "sent"', async () => {
    await render(
      <CallReportScreen
        {...props}
        sentNote={{
          title: 'Report saved',
          detail:
            'Saved on this phone. It will send by itself when you have signal — you do not have to retype it.',
        }}
      />,
    );
    expect(screen.getByText('Report saved')).toBeTruthy();
    // The defect, stated as an assertion: the queued banner must not be headed "Report sent".
    expect(screen.queryByText('Report sent')).toBeNull();
  });

  it('THE POSITIVE CONTROL: the title comes from the CALLER, not from this component', async () => {
    // The defect was a title hardcoded in this file. Asserting "sent" and "saved" render
    // would both pass against a component that hardcoded whichever of the two a test happened
    // to check first. What is actually required is that the banner prints what it is GIVEN —
    // so it is given something neither branch would ever pass, and must print that.
    //
    // One render per test, deliberately: two renders in one case is the trap
    // `home-route.test.tsx` documents, where the second render leaks into the next test.
    await render(
      <CallReportScreen
        {...props}
        sentNote={{ title: 'A title no branch produces', detail: 'and its detail' }}
      />,
    );
    expect(screen.getByText('A title no branch produces')).toBeTruthy();
    expect(screen.queryByText('Report sent')).toBeNull();
  });

  it('renders no banner at all before the MR presses send', async () => {
    // The third state, and the one a "does it say sent or saved" pair would not cover: an
    // untouched form must make no claim in either direction.
    await render(<CallReportScreen {...props} />);
    expect(screen.queryByText('Report sent')).toBeNull();
    expect(screen.queryByText('Report saved')).toBeNull();
  });
});
