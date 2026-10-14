import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ useRouter: () => ({}) }));

const { backOrHome } = await import('./back');

/** `FE-W188`. The on-screen Back never does nothing. */
describe('backOrHome', () => {
  it('goes back when there is a screen underneath', () => {
    const router = { canGoBack: () => true, back: vi.fn(), replace: vi.fn() };
    backOrHome(router);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('goes to Today when the screen was opened with nothing underneath', () => {
    const router = { canGoBack: () => false, back: vi.fn(), replace: vi.fn() };
    backOrHome(router);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/home');
  });
});
