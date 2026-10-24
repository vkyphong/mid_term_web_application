import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  preserveOutput: 'never',
  // Runtime scratch files stay outside the repository. No demo artifacts are captured.
  outputDir: join(tmpdir(), 'pulsechat-playwright'),
  use: {
    baseURL: 'http://localhost:8080',
    browserName: 'chromium',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})
