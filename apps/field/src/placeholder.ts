/**
 * PLACEHOLDER — the Expo app is Frontend's, from week 1.
 *
 * Backend created the workspace entry, the tsconfig and the dependency on
 * `@elmiron/core` so that CI has something to typecheck and the import path is
 * settled. Frontend runs `create-expo-app` into this directory and deletes this
 * file. Do not build screens here.
 *
 * The reference below exists only to prove the contract package resolves.
 */

import { ROLES } from '@elmiron/core';

export const supportedRoles: readonly string[] = ROLES;
