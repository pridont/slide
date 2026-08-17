import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // e2e/ is Playwright's; it speaks a different test API.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'examples/**'],
    include: ['src/**/*.test.ts'],
  },
})
