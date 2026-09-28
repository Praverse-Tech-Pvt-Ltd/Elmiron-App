import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * FE-D7 3 — is Android's "Remove animations" on?
 *
 * React Native's `isReduceMotionEnabled` reads the global transition animation scale on Android
 * (`AccessibilityInfoModule.kt`), which is exactly what "Remove animations" sets to 0, and emits
 * `reduceMotionChanged` when it changes. So this follows the setting live, not only at launch.
 *
 * Starts `false`: the first screen has no transition to animate, and the answer arrives before
 * any navigation can happen. A phone that cannot answer keeps animations, which is the platform's
 * own default.
 */
export const useReduceMotion = (): boolean => {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (live) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
};
