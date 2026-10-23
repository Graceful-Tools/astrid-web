# End-to-End Testing with Playwright

This directory contains end-to-end tests for the Astrid Task Manager using [Playwright](https://playwright.dev).

## 📁 Test Structure

```
e2e/
├── fixtures/
│   └── auth.ts              # Authentication fixtures and helpers
├── utils/
│   └── test-helpers.ts      # Shared test utilities and helper classes
├── auth.spec.ts             # Authentication flow tests
├── tasks.spec.ts            # Task management tests
├── lists.spec.ts            # List management tests
├── layout-regression.spec.ts # Column layouts per viewport project
├── mobile-*.spec.ts         # Mobile shell/header/keyboard behaviour
├── accessibility.spec.ts    # Accessibility (a11y) tests
└── README.md               # This file
```

## 🚀 Getting Started

### Installation

Install Playwright and its dependencies:

```bash
npm install -D @playwright/test playwright
```

Install browser binaries:

```bash
npm run playwright:install
```

### Running Tests

**Run all E2E tests:**
```bash
npm run test:e2e
```

**Run tests in UI mode (recommended for development):**
```bash
npm run test:e2e:ui
```

**Run tests in headed mode (see browser):**
```bash
npm run test:e2e:headed
```

**Run tests in debug mode:**
```bash
npm run test:e2e:debug
```

**Run tests for specific browser:**
```bash
npm run test:e2e:chromium
npm run test:e2e:firefox
npm run test:e2e:webkit
```

**Run mobile tests:**
```bash
npm run test:e2e:mobile
```

**View test report:**
```bash
npm run test:e2e:report
```

## 📝 Test Categories

### Authentication Tests (`auth.spec.ts`)
- Modern auth options (Google OAuth, Passkeys)
- Passkey registration and authentication flow
- Legacy email/password option (behind "Legacy" link)
- OAuth provider integration
- Session management
- Error handling

### Task Management Tests (`tasks.spec.ts`)
- Task creation and editing
- Task completion toggle
- Task deletion
- Comments and attachments
- Due dates and priorities
- Keyboard shortcuts

### List Management Tests (`lists.spec.ts`)
- List creation and deletion
- List navigation
- List settings and customization
- Sharing and collaboration
- Public/private lists

### Layout Tests (`layout-regression.spec.ts`, `mobile-*.spec.ts`)
- Computer and tablet column layouts (one Playwright project per layout)
- Mobile shell, header and keyboard behaviour

### Accessibility Tests (`accessibility.spec.ts`)
- ARIA labels and roles
- Keyboard navigation
- Focus management
- Color contrast
- Screen reader support
- Semantic HTML

## 🛠️ Helper Utilities

### TaskHelpers

```typescript
import { TaskHelpers } from './utils/test-helpers'

const taskHelpers = new TaskHelpers(page)

// Create a task
await taskHelpers.createTask('My new task')

// Get task by title
const task = taskHelpers.getTaskByTitle('My task')

// Complete a task
await taskHelpers.completeTask('My task')

// Delete a task
await taskHelpers.deleteTask('My task')

// Open task details
await taskHelpers.openTaskDetails('My task')
```

### ListHelpers

```typescript
import { ListHelpers } from './utils/test-helpers'

const listHelpers = new ListHelpers(page)

// Create a list
await listHelpers.createList('My List')

// Switch to a list
await listHelpers.switchToList('My List')

// Get list by name
const list = listHelpers.getListByName('My List')

// Delete a list
await listHelpers.deleteList('My List')
```

### NavigationHelpers

```typescript
import { NavigationHelpers } from './utils/test-helpers'

const navHelpers = new NavigationHelpers(page)

// Navigate to home
await navHelpers.goToHome()

// Navigate to settings
await navHelpers.goToSettings()

// Navigate to specific list
await navHelpers.goToList('list-id')

// Open user menu
await navHelpers.openUserMenu()
```

### Utility Functions

```typescript
import { waitForApiCall, waitForNetworkIdle, getAllTasks } from './utils/test-helpers'

// Wait for specific API call
await waitForApiCall(page, /\/api\/tasks/)

// Wait for network to be idle
await waitForNetworkIdle(page)

// Get all tasks on page
const tasks = await getAllTasks(page)
```

## 🔧 Configuration

The Playwright configuration is defined in [`playwright.config.ts`](../playwright.config.ts):

- **Base URL**: `http://localhost:3000` (configurable via `PLAYWRIGHT_TEST_BASE_URL`)
- **Browsers**: Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari
- **Retries**: 2 on CI, 0 locally
- **Traces**: Captured on first retry
- **Screenshots/Videos**: Captured on failure
- **Web Server**: Auto-starts dev server before tests

## 🔐 Authentication Setup

Signed-in specs use a **minted NextAuth session**, not a sign-in flow. `npm run playwright:setup:ci-auth` (`scripts/create-e2e-auth-state.ts`) upserts `playwright-owner@example.test` and `playwright-outsider@example.test` in the database named by `TEST_DATABASE_URL` (localhost, name containing `test`), grants the owner Project Mode, and writes `.auth/user.json` and `.auth/outsider.json`.

The signed-in projects (`authenticated-critical`, `authenticated-ui`) exist only when `PLAYWRIGHT_AUTHENTICATED=1`:

```bash
TEST_DATABASE_URL=postgresql://…/astrid_e2e_test DATABASE_URL=$TEST_DATABASE_URL \
  NEXTAUTH_SECRET=<32+ chars> NEXTAUTH_URL=http://localhost:3000 npm run playwright:setup:ci-auth
# run the app with the same DATABASE_URL / NEXTAUTH_SECRET, then:
PLAYWRIGHT_AUTHENTICATED=1 npm run test:e2e:authenticated-critical   # both signed-in projects
```

### Every spec must run somewhere

Each project has a `testMatch` allow-list, and a spec no project matches simply never runs (24 of 31 didn't, until AWTD-1338). `tests/rules/every-e2e-spec-runs.test.ts` fails on any `e2e/*.spec.ts` that is neither matched by a project nor listed in `PENDING_E2E_SPECS` (playwright.config.ts) with a reason. **Adding a spec means adding it to a project.** The pending list may only shrink.

### Unauthenticated Tests

`auth.spec.ts`, `locale-navigation`, `layout-regression`, `document-pages-scroll`, `hover-theme-variants` and `mobile-keyboard-no-list-shift` run signed out in the browser projects.

## 📊 CI/CD Integration

E2E tests run automatically in GitHub Actions on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`
- Manual workflow dispatch

See [`.github/workflows/e2e-tests.yml`](../.github/workflows/e2e-tests.yml) for the workflow configuration.

Test results and traces are uploaded as artifacts and retained for 30 days.

## 📈 Test Coverage

### Current Test Coverage

- ✅ Authentication flows
- ✅ Task CRUD operations
- ✅ List management
- ✅ Responsive layouts (mobile, tablet, desktop)
- ✅ Performance metrics
- ✅ Accessibility standards
- ⏳ Real-time collaboration (pending)
- ⏳ File uploads (pending)
- ⏳ Notifications (pending)

### Adding New Tests

1. Create a new spec file in `e2e/` directory
2. Import test utilities from `./utils/test-helpers`
3. Use descriptive test names
4. Follow existing test patterns
5. Add appropriate waits for API calls and animations

Example:

```typescript
import { test, expect } from '@playwright/test'
import { TaskHelpers, waitForApiCall } from './utils/test-helpers'

test.describe('My New Feature', () => {
  let taskHelpers: TaskHelpers

  test.beforeEach(async ({ page }) => {
    taskHelpers = new TaskHelpers(page)
    await page.goto('/')
  })

  test('should do something', async ({ page }) => {
    // Your test code here
  })
})
```

## 🐛 Debugging Tests

### Debug Mode

Run tests in debug mode to step through them:

```bash
npm run test:e2e:debug
```

### UI Mode

Use UI mode for a visual debugging experience:

```bash
npm run test:e2e:ui
```

### Trace Viewer

View traces of failed tests:

```bash
npx playwright show-trace test-results/[test-name]/trace.zip
```

### VS Code Extension

Install the [Playwright VS Code extension](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright) for integrated debugging.

## 📚 Best Practices

1. **Use Role Selectors**: Prefer `getByRole()` over CSS selectors
2. **Wait for Network**: Use `waitForApiCall()` after mutations
3. **Isolation**: Each test should be independent
4. **Clean State**: Use `beforeEach` to reset state
5. **Descriptive Names**: Use clear, descriptive test names
6. **DRY**: Use helper utilities to avoid repetition
7. **Accessibility**: Follow WCAG guidelines in tests
8. **Performance**: Monitor Core Web Vitals
9. **Mobile-First**: Test responsive behavior

## 🔗 Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright API Reference](https://playwright.dev/docs/api/class-playwright)
- [Test Assertions](https://playwright.dev/docs/test-assertions)
- [Debugging Guide](https://playwright.dev/docs/debug)

## 🤝 Contributing

When adding new E2E tests:

1. Follow the existing test structure
2. Add helper utilities for reusable logic
3. Document complex test scenarios
4. Ensure tests pass on all browsers
5. Update this README if adding new test categories
