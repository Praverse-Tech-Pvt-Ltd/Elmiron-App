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
export type { BannerAction, BannerProps, BannerTone } from './Banner';
export { BeatPlanScreen } from './BeatPlanScreen';
export type { BeatPlanScreenProps, BeatPlanStop } from './BeatPlanScreen';
export { BottomSheet } from './BottomSheet';
export type { BottomSheetProps } from './BottomSheet';
export { Button } from './Button';
export type { ButtonProps, ButtonVariant } from './Button';
export { CallReportScreen } from './CallReportScreen';
export type { CallReportScreenProps } from './CallReportScreen';
export { Card } from './Card';
export type { CardProps, CardTone } from './Card';
export { CitationSpan } from './CitationSpan';
export { ConsentScreen } from './ConsentScreen';
export type {
  ConsentAnswer,
  ConsentFact,
  ConsentLanguageOption,
  ConsentScreenProps,
  ConsentVariant,
} from './ConsentScreen';
export { ConsentDetailsScreen } from './ConsentDetailsScreen';
export type { ConsentDetailItem, ConsentDetailsScreenProps } from './ConsentDetailsScreen';
export { DayEndScreen } from './DayEndScreen';
export type { DayEndScreenProps } from './DayEndScreen';
export type { CitationSpanProps } from './CitationSpan';
export { DoctorListScreen } from './DoctorListScreen';
export { DoctorProfileScreen } from './DoctorProfileScreen';
export type { DoctorProfileScreenProps, DoctorProfileVisitRow } from './DoctorProfileScreen';
export type { DoctorListRow, DoctorListScreenProps } from './DoctorListScreen';
export { FindingCard } from './FindingCard';
export type { FindingCardProps, FindingKind } from './FindingCard';
export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';
export { ListItem } from './ListItem';
export type { ListItemProps } from './ListItem';
export { OverrideControl } from './OverrideControl';
export type { OverrideControlProps, OverrideDecision } from './OverrideControl';
export { RecordingIndicator } from './RecordingIndicator';
export type { RecordingIndicatorProps, RecordingState } from './RecordingIndicator';
export { Select } from './Select';
export { SettingsScreen } from './SettingsScreen';
export type { SettingRow, SettingState, SettingsScreenProps } from './SettingsScreen';
export type { SelectOption, SelectProps } from './Select';
export { STATUS_COLOR, STATUS_FILL, StatusGlyph } from './StatusGlyph';
export type { StatusGlyphProps, StatusKind } from './StatusGlyph';
export { SyncQueueIndicator } from './SyncQueueIndicator';
export type { SyncQueueIndicatorProps, SyncQueueState } from './SyncQueueIndicator';
export { TOAST_DURATION_MS, Toast } from './Toast';
export type { ToastAction, ToastProps } from './Toast';
export { BodyText, Display, Figure, Heading, Label, Statement } from './Text';
export type { TextProps } from './Text';
export { ListRow } from './ListRow';
export type { ListRowProps } from './ListRow';
export { MileageScreen } from './MileageScreen';
export type { MileageDayRow, MileageScreenProps } from './MileageScreen';
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
export { SamplesScreen } from './SamplesScreen';
export type {
  SampleLine,
  SampleLineKind,
  SampleLinePatch,
  SamplesCap,
  SamplesScreenProps,
} from './SamplesScreen';
export { Screen } from './Screen';
export { SetupStepList } from './SetupStepList';
export type { SetupStepListProps, SetupStepView } from './SetupStepList';
export type { ScreenProps } from './Screen';
export { Spinner } from './Spinner';
export { Stepper } from './Stepper';
export type { StepperProps } from './Stepper';
export type { SpinnerProps } from './Spinner';
export { TransparencyScreen } from './TransparencyScreen';
export type {
  TransparencyEntry,
  TransparencyScreenProps,
  TransparencyState,
} from './TransparencyScreen';
export { VisitScreen } from './VisitScreen';
export type { VisitScreenProps } from './VisitScreen';
export { TodayScreen } from './TodayScreen';
export type { TodayNextVisit, TodayScreenProps } from './TodayScreen';
export { TextField } from './TextField';
export type { TextFieldProps } from './TextField';
