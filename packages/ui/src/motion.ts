import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';

/**
 * FE-W101. Motion for the shared components, and the one switch that turns all of it off.
 *
 * **Every animation here is an arrival, never a press.** §05 says a press darkens the fill and
 * never scales or fades, and that still holds: what moves is content appearing, a toast arriving,
 * a sheet rising, a placeholder breathing while the day loads. Nothing waits for one of them — a
 * control is live from its first frame, so an animation can only ever be decoration over a screen
 * that already works.
 *
 * **Native driver only** — opacity and transform, which run on the UI thread and never touch
 * layout, so a mid-range phone keeps its frames while the JS thread is busy with a sync.
 */

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
 *
 * Moved here from `apps/field/src/reduce-motion.ts` (which re-exports it) so the components that
 * animate can obey the same setting the stack transition does.
 */
const useOwnReduceMotion = (enabled: boolean): boolean => {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (live) setReduceMotion(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduceMotion(value);
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, [enabled]);

  return reduceMotion;
};

/**
 * The app's answer, provided once at the root so a screen of twenty animated blocks asks the
 * platform once rather than twenty times. `null` — no provider — makes each hook ask for itself,
 * which is what a component rendered on its own (a test, a story) needs.
 */
export const ReduceMotionContext = createContext<boolean | null>(null);

export const useReduceMotion = (): boolean => {
  const provided = useContext(ReduceMotionContext);
  const own = useOwnReduceMotion(provided === null);
  return provided ?? own;
};

export interface EntranceOptions {
  /** Position in a sequence; each step waits `tokens.motion.stagger` more. */
  readonly index?: number;
  readonly duration?: number;
  /** Points to rise from. 0 for a pure fade. */
  readonly rise?: number;
}

/** The style an entering block wears, once settled — and from the start under reduce-motion. */
export const SETTLED = { opacity: 1, transform: [{ translateY: 0 }] } as const;

/**
 * An opacity and a rise that run once, on mount.
 *
 * Under reduce-motion the values start settled and nothing runs, so the content is simply there.
 * If the setting flips while an entrance is running, the entrance jumps to its end.
 */
export const useEntrance = ({
  index = 0,
  duration = tokens.motion.standard,
  rise = tokens.motion.rise,
}: EntranceOptions = {}): {
  readonly opacity: Animated.Value;
  readonly transform: readonly [{ readonly translateY: Animated.Value }];
} => {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const offset = useRef(new Animated.Value(reduceMotion ? 0 : rise)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.stopAnimation();
      offset.stopAnimation();
      progress.setValue(1);
      offset.setValue(0);
      return undefined;
    }
    const delay = index * tokens.motion.stagger;
    const easing = Easing.out(Easing.cubic);
    const run = Animated.parallel([
      Animated.timing(progress, { toValue: 1, duration, delay, easing, useNativeDriver: true }),
      Animated.timing(offset, { toValue: 0, duration, delay, easing, useNativeDriver: true }),
    ]);
    run.start();
    return () => {
      run.stop();
    };
    // Mount-only by design: an entrance that replayed on every prop change would flicker the
    // screen each time the day refreshed. `reduceMotion` is the one input allowed to cut it short.
  }, [reduceMotion]);

  return { opacity: progress, transform: [{ translateY: offset }] };
};

/**
 * A gentle opacity breath for a loading placeholder, between 1 and `low`. Held still at 1 under
 * reduce-motion — a placeholder that does not move is still a placeholder.
 */
export const usePulse = (low = 0.55): Animated.Value => {
  const reduceMotion = useReduceMotion();
  const value = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) {
      value.stopAnimation();
      value.setValue(1);
      return undefined;
    }
    const easing = Easing.inOut(Easing.quad);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: low,
          duration: tokens.motion.pulse,
          easing,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 1,
          duration: tokens.motion.pulse,
          easing,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [low, reduceMotion, value]);

  return value;
};
