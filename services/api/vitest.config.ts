import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.spec.ts'],
    // The local Supabase stack has to come up before these can connect.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
