import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { SCREEN_OFF_TASK, deliver, screenOffSink } from './screen-off';

/**
 * `FE-W207` — the task the location foreground service delivers to. TaskManager requires it to be
 * defined at module scope, before anything starts the service, so `app/_layout.tsx` imports this
 * file first. It holds no decision: `deliver` hands each position to the live tracker, or stops the
 * service when there is no tracker to decide about it.
 */
TaskManager.defineTask(SCREEN_OFF_TASK, ({ data, error }) => {
  if (deliver(data, error, screenOffSink()) === 'stop') {
    void Location.stopLocationUpdatesAsync(SCREEN_OFF_TASK).catch(() => undefined);
  }
  return Promise.resolve();
});
