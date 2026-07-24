import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Per-file environment via // @vitest-environment jsdom docblocks.
  },
});
