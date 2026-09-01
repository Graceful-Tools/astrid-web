import { defineConfig, devices } from '@playwright/test'

const authenticatedCriticalEnabled = process.env.PLAYWRIGHT_AUTHENTICATED === '1'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Global setup runs once before all tests to warm up the server */
  globalSetup: require.resolve('./e2e/global-setup'),
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on failure - helps with flaky server warmup race conditions */
  retries: process.env.CI ? 2 : 1,
  /* Limit workers to reduce server contention during parallel browser tests */
  workers: process.env.CI ? 1 : 3,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    // open: 'never' so chained scripts (predeploy:full) aren't blocked by an
    // auto-launched report browser when a flake happens
    ['html', { open: 'never' }],
    ['list'],
    process.env.CI ? ['github'] : ['list']
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    // Unauthenticated tests (auth flows, public pages, locale navigation,
    // and the layout-regression matrix where the device's natural width
    // produces a computer-3-column layout).
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /(auth|locale-navigation|layout-regression|document-pages-scroll)\.spec\.ts/,
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: /(auth|locale-navigation)\.spec\.ts/,
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: /(auth|locale-navigation)\.spec\.ts/,
    },

    // Mobile tests (unauthenticated). Pixel 5 / iPhone 12 viewports are both
    // < 910px so they land in mobile-1-column.
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: /(auth|locale-navigation|layout-regression|mobile-keyboard-no-list-shift|document-pages-scroll)\.spec\.ts/,
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
      testMatch: /(auth|locale-navigation)\.spec\.ts/,
    },

    ...(authenticatedCriticalEnabled ? [{
      name: 'authenticated-critical',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      testMatch: /authenticated-critical-paths\.spec\.ts/,
    }] : []),

    // Layout-regression matrix: each project below pins a viewport that
    // exercises one of the layouts defined in lib/layout-detection.ts.
    // computer-3-column is covered by the chromium project above.
    {
      name: 'computer-1-column',
      use: { ...devices['Desktop Chrome'], viewport: { width: 800, height: 900 } },
      testMatch: /layout-regression\.spec\.ts/,
    },
    {
      name: 'computer-2-column',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1000, height: 900 } },
      testMatch: /layout-regression\.spec\.ts/,
    },
    {
      name: 'tablet-2-column',
      // iPad Mini portrait (768x1024) — iPad UA + width < 1100 →
      // tablet-2-column (after the iPad-before-mobile fix in
      // lib/layout-detection.ts).
      use: { ...devices['iPad Mini'] },
      testMatch: /layout-regression\.spec\.ts/,
    },
    {
      name: 'tablet-3-column',
      // iPad Pro 11 landscape (1194x834) — iPad UA + width ≥ 1100 →
      // tablet-3-column.
      use: { ...devices['iPad Pro 11 landscape'] },
      testMatch: /layout-regression\.spec\.ts/,
    },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: process.env.CI ? 'npx next start' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
