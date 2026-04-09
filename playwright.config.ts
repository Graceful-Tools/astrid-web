import { defineConfig, devices } from '@playwright/test'

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
    ['html'],
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
    // Unauthenticated tests (auth flows, public pages, locale navigation)
    // Run these first as they don't require setup
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /(auth|locale-navigation)\.spec\.ts/,
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

    // Mobile tests (unauthenticated)
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: /(auth|locale-navigation)\.spec\.ts/,
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
      testMatch: /(auth|locale-navigation)\.spec\.ts/,
    },

    // Setup project - runs once to authenticate (optional, only if env vars are set)
    // Skip this if PLAYWRIGHT_TEST_EMAIL is not set
    ...(process.env.PLAYWRIGHT_TEST_EMAIL ? [{
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    }] : []),

    // Tests that require authentication (only run if setup is available)
    ...(process.env.PLAYWRIGHT_TEST_EMAIL ? [
      {
        name: 'chromium-authenticated',
        use: {
          ...devices['Desktop Chrome'],
          storageState: '.auth/user.json',
        },
        dependencies: ['setup'],
        testIgnore: /auth\.spec\.ts/, // Skip auth tests that don't need auth
      },

      {
        name: 'firefox-authenticated',
        use: {
          ...devices['Desktop Firefox'],
          storageState: '.auth/user.json',
        },
        dependencies: ['setup'],
        testIgnore: /auth\.spec\.ts/,
      },

      {
        name: 'webkit-authenticated',
        use: {
          ...devices['Desktop Safari'],
          storageState: '.auth/user.json',
        },
        dependencies: ['setup'],
        testIgnore: /auth\.spec\.ts/,
      },

      /* Test against mobile viewports (authenticated) */
      {
        name: 'Mobile Chrome Authenticated',
        use: {
          ...devices['Pixel 5'],
          storageState: '.auth/user.json',
        },
        dependencies: ['setup'],
        testIgnore: /auth\.spec\.ts/,
      },
      {
        name: 'Mobile Safari Authenticated',
        use: {
          ...devices['iPhone 12'],
          storageState: '.auth/user.json',
        },
        dependencies: ['setup'],
        testIgnore: /auth\.spec\.ts/,
      },
    ] : []),

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
