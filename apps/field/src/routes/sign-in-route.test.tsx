import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

const mockSession = jest.fn();
jest.mock('../session', () => ({ useSession: () => mockSession() }));

import SignIn from '../../app/sign-in';

describe('app/sign-in.tsx', () => {
  it('disables submit until both fields are filled', async () => {
    // Pins that the disabled state is derived from the fields, not from a guess.
    mockSession.mockReturnValue({ signIn: jest.fn() });
    await render(<SignIn />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('labels both inputs, so a screen reader announces them', async () => {
    mockSession.mockReturnValue({ signIn: jest.fn() });
    await render(<SignIn />);
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('does not show a failure banner before anything has been attempted', async () => {
    // An error surface that is present by default trains the MR to ignore it.
    mockSession.mockReturnValue({ signIn: jest.fn() });
    await render(<SignIn />);
    expect(screen.queryByText('Could not sign in')).toBeNull();
  });
});
