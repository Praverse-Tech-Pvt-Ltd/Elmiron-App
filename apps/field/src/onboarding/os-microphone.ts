import { PermissionsAndroid } from 'react-native';
import { AudioModule } from 'expo-audio';
import { RECORD_AUDIO } from './microphone-gate';
import type { AndroidPermissionResult } from './notification-permission';
import { asAndroidResult } from './os-permission-answer';
import { isIos } from './os-permissions';

/**
 * `FE-W161` — the microphone: Android's `RECORD_AUDIO`, or iOS's microphone prompt via `expo-audio`
 * (whose wording is `microphonePermission` in `app.json`). Apart from `os-permissions.ts` so that only
 * the screens which ask for the microphone load `expo-audio`.
 */
export const requestMicrophoneAnswer = async (): Promise<AndroidPermissionResult> => {
  if (!isIos()) return PermissionsAndroid.request(RECORD_AUDIO);
  return asAndroidResult(await AudioModule.requestRecordingPermissionsAsync());
};
