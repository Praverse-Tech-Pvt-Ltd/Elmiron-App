/**
 * Every shared component.
 *
 * `apps/field` defines none of its own — an ESLint rule in the repo root fails the
 * build if it imports a visual primitive from `react-native` directly. The console
 * consumes this package from FE-W6 and a second app later, and extracting
 * components after those exist is a rewrite of every screen.
 *
 * Two properties worth keeping:
 * - **Nothing here knows about routing.** Components take `onPress`; the caller
 *   decides what that means. `expo-router` and Next.js disagree about navigation
 *   and this package has to work under both.
 * - **Every pressable has a press state.** A mobile control that does not respond
 *   to touch reads as a broken app on a slow connection.
 *
 * Imports here are extensionless, unlike the rest of the repo. This package is
 * resolved by Metro, which does not perform the `.js` → `.tsx` substitution that
 * TypeScript's NodeNext resolution does.
 */

export { Banner } from './Banner';
export type { BannerProps, BannerTone } from './Banner';
export { BodyText, Heading, Label } from './Text';
export type { TextProps } from './Text';
export { ListRow } from './ListRow';
export type { ListRowProps } from './ListRow';
export { OemBatteryScreen } from './OemBatteryScreen';
export type { OemBatteryScreenProps } from './OemBatteryScreen';
export { PrimaryButton } from './PrimaryButton';
export { LONG_RETRY_AFTER_ATTEMPTS, QueueScreen, rowStateFor } from './QueueScreen';
export type {
  QueueRowState,
  QueueScreenItem,
  QueueScreenProps,
  QueueScreenRejection,
} from './QueueScreen';
export type { PrimaryButtonProps } from './PrimaryButton';
export { Screen } from './Screen';
export { SetupStepList } from './SetupStepList';
export type { SetupStepListProps, SetupStepView } from './SetupStepList';
export type { ScreenProps } from './Screen';
export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';
export { TextField } from './TextField';
export type { TextFieldProps } from './TextField';
