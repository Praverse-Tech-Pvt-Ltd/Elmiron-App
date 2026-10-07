import { appLiveConnection } from '../live-connection';
import { createLiveLearningBackend } from './live';
import type { LearningBackend } from './live';

/**
 * W2-F B — one live learning backend for the app process, as the signed-in rep. Made on first use, so
 * importing a route (as the route tests do, injecting their own) never builds one.
 */
let shared: LearningBackend | null = null;
export const appLearningBackend = (): LearningBackend => {
  shared ??= createLiveLearningBackend(appLiveConnection());
  return shared;
};
