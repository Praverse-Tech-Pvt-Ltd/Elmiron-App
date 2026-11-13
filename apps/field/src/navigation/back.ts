import { useCallback } from 'react';
import { useRouter } from 'expo-router';

/**
 * `FE-W188` — what a screen's Back control (`Screen`'s `onBack`) does.
 *
 * Back to the screen underneath, as the phone's own Back would. A screen opened with nothing
 * underneath it — from a notification or a link, straight onto a visit — goes to Today instead:
 * `router.back()` with no history does nothing, and a Back control that does nothing is the trap
 * the QA pass reported.
 */
export const backOrHome = (router: {
  readonly canGoBack: () => boolean;
  readonly back: () => void;
  readonly replace: (href: '/home') => void;
}): void => {
  if (router.canGoBack()) router.back();
  else router.replace('/home');
};

export const useBack = (): (() => void) => {
  const router = useRouter();
  return useCallback(() => {
    backOrHome(router);
  }, [router]);
};
