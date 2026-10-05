import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { AiAllowanceNotice } from './AiAllowanceNotice';

/**
 * FE-D14 — the daily AI-limit warning.
 *
 * Every figure on it is the SERVER's: `requestsUsedToday` and `dailyLimit` from `ai_begin_request`,
 * and the reset time when the server sends one. The component formats what it is given and never
 * supplies a number of its own, so each case below uses figures the component could not have
 * guessed.
 */

describe('AiAllowanceNotice — before the limit', () => {
  it("states the server's figures", async () => {
    await render(
      <AiAllowanceNotice
        allowance={{ kind: 'warning', used: 83, limit: 104, resetLabel: '00:00 on 2 Oct' }}
        sample={false}
      />,
    );

    expect(screen.getByText("You have used 83 of today's 104 assistant requests.")).toBeTruthy();
    expect(screen.getByText('The allowance resets at 00:00 on 2 Oct.')).toBeTruthy();
  });

  it('with no reset time from the server, says so rather than inventing one', async () => {
    await render(
      <AiAllowanceNotice
        allowance={{ kind: 'warning', used: 41, limit: 50, resetLabel: null }}
        sample={false}
      />,
    );

    expect(screen.getByText('The server has not said when the allowance resets.')).toBeTruthy();
    expect(screen.queryByText(/midnight|00:00/u)).toBeNull();
  });
});

describe('AiAllowanceNotice — at the limit', () => {
  it('says plainly that the assistant is unavailable until the reset', async () => {
    await render(
      <AiAllowanceNotice
        allowance={{ kind: 'at_limit', resetLabel: '00:00 on 2 Oct' }}
        sample={false}
      />,
    );

    expect(
      screen.getByText(
        "You have reached today's limit. The assistant is unavailable until it resets.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('It resets at 00:00 on 2 Oct.')).toBeTruthy();
  });

  it('with no reset time from the server, gives none', async () => {
    await render(
      <AiAllowanceNotice allowance={{ kind: 'at_limit', resetLabel: null }} sample={false} />,
    );

    expect(screen.getByText('The server has not said when it resets.')).toBeTruthy();
    expect(screen.queryByText(/\d/u)).toBeNull();
  });
});

describe('AiAllowanceNotice — honesty', () => {
  it('shows nothing at all when the server reported no usage — never a zero', async () => {
    await render(<AiAllowanceNotice allowance={{ kind: 'not_reported' }} sample={false} />);

    expect(screen.queryByText(/\d/u)).toBeNull();
    expect(screen.queryByText(/limit|allowance/u)).toBeNull();
  });

  it('labels sample figures as sample data', async () => {
    await render(
      <AiAllowanceNotice
        allowance={{ kind: 'warning', used: 80, limit: 100, resetLabel: null }}
        sample
      />,
    );

    expect(screen.getByText('Sample data, not from the server.')).toBeTruthy();
  });

  it('POSITIVE CONTROL: real figures carry no sample label', async () => {
    await render(
      <AiAllowanceNotice
        allowance={{ kind: 'warning', used: 80, limit: 100, resetLabel: null }}
        sample={false}
      />,
    );

    expect(screen.queryByText('Sample data, not from the server.')).toBeNull();
  });
});
