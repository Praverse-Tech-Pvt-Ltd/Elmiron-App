import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Logic only. Nothing here renders a component or touches a native module —
    // those need a development build and a device, neither of which exists yet.
    include: ['src/**/*.test.ts'],
  },
});
