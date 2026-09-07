// `react-native-safe-area-context` reads its insets from a context and THROWS when
// no provider is mounted. In the app that is correct and deliberately loud — the
// provider is in `app/_layout.tsx` and a missing one should fail immediately rather
// than silently render zero insets, which is the defect this guard exists to catch.
//
// In tests it would mean every component that renders `Screen` has to know about
// safe areas. The library ships a mock for exactly this; it spreads the real module
// (so `SafeAreaProvider` still works) and returns the context value when one is
// present, falling back to ZERO insets when it is not.
//
// Zero is the important part: a test that renders without a provider gets `md + 0`
// and would pass with the inset removed. Screen.test.tsx therefore supplies its own
// non-zero metrics rather than relying on this mock's defaults.
// `.default` is load-bearing: the shipped mock is an ES module whose default export
// is the replacement module. Returning the namespace object instead gives a module
// whose `useSafeAreaInsets` is undefined, and the failure reads
// "(0 , _reactNativeSafeAreaContext.useSafeAreaInsets) is not a function".
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
