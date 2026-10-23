# Playwright E2E Testing - Quick Start Guide

## ⚡ 3-Step Setup

### 1. Install Browser Binaries (One-Time)
```bash
npm run playwright:install
```

### 2. Run Tests
```bash
# UI Mode (Recommended - Visual debugging)
npm run test:e2e:ui

# Or run all tests in headless mode
npm run test:e2e
```

### 3. View Results
```bash
npm run test:e2e:report
```

---

## 📝 Common Commands

### Development
```bash
npm run test:e2e:ui        # Visual test runner (best for development)
npm run test:e2e:headed    # Watch tests run in browser
npm run test:e2e:debug     # Step-by-step debugging
```

### Specific Browsers
```bash
npm run test:e2e:chromium  # Chrome/Edge
npm run test:e2e:firefox   # Firefox
npm run test:e2e:webkit    # Safari
npm run test:e2e:mobile    # Mobile Chrome & Safari
```

### CI/Production
```bash
npm run test:e2e           # Run all tests (headless)
```

---

## 🧪 What's Tested

### Authentication (`e2e/auth.spec.ts`)
- ✅ Sign-in/sign-up flows
- ✅ OAuth integration
- ✅ Form validation
- ✅ Error handling

### Tasks (`e2e/tasks.spec.ts`)
- ✅ Create, edit, delete tasks
- ✅ Task completion
- ✅ Comments
- ✅ Due dates & priorities

### Lists (`e2e/lists.spec.ts`)
- ✅ Create, delete lists
- ✅ List navigation
- ✅ Sharing & collaboration
- ✅ Public/private lists

### Layout (`e2e/layout-regression.spec.ts`, `e2e/mobile-*.spec.ts`)
- ✅ Computer and tablet column layouts
- ✅ Mobile shell and header

### Accessibility (`e2e/accessibility.spec.ts`)
- ✅ Keyboard navigation
- ✅ Screen readers
- ✅ ARIA labels
- ✅ Focus management

---

## 🔧 Writing Your First Test

Create a new file in `e2e/` directory:

```typescript
import { test, expect } from '@playwright/test'

test('my feature works', async ({ page }) => {
  // Navigate to page
  await page.goto('/')

  // Interact with elements
  const button = page.getByRole('button', { name: /click me/i })
  await button.click()

  // Verify result
  await expect(page.getByText('Success!')).toBeVisible()
})
```

**See `e2e/auth.spec.ts` for patterns, and add your spec to a project's `testMatch` in `playwright.config.ts` — specs outside every project never run.**

---

## 🛠️ Helper Utilities

### TaskHelpers
```typescript
import { TaskHelpers } from './utils/test-helpers'

const taskHelpers = new TaskHelpers(page)
await taskHelpers.createTask('My task')
await taskHelpers.completeTask('My task')
```

### ListHelpers
```typescript
import { ListHelpers } from './utils/test-helpers'

const listHelpers = new ListHelpers(page)
await listHelpers.createList('My list')
await listHelpers.switchToList('My list')
```

---

## 🐛 Debugging

### UI Mode (Best Option)
```bash
npm run test:e2e:ui
```
- See tests run live
- Time travel through actions
- Inspect DOM at each step

### Debug Mode
```bash
npm run test:e2e:debug
```
- Step through tests
- Pause execution
- Inspect variables

### VS Code Extension
Install: [Playwright Test for VSCode](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright)

---

## 🚨 Authentication Setup

**⚠️ Required for user-authenticated tests**

Edit: `e2e/fixtures/auth.ts`

Choose one approach:
1. **Test API endpoint** - Provision test users via API
2. **Database seeding** - Pre-seed test credentials
3. **Auth bypass** - Test-only authentication bypass

See fixture file for implementation guidance.

---

## 📊 CI/CD Integration

Tests run automatically on:
- ✅ Push to `main` or `develop`
- ✅ Pull requests
- ✅ Manual workflow dispatch

View results in GitHub Actions → Test reports uploaded as artifacts

---

## 📚 Full Documentation

- **Comprehensive Guide**: [e2e/README.md](../../e2e/README.md)
- **Setup Guide**: [PLAYWRIGHT_SETUP.md](./PLAYWRIGHT_SETUP.md)
- **Official Docs**: https://playwright.dev

---

## ✅ Checklist

- [ ] Install browsers: `npm run playwright:install`
- [ ] Configure auth: Edit `e2e/fixtures/auth.ts`
- [ ] Run tests: `npm run test:e2e:ui`
- [ ] Review test coverage in `e2e/` directory
- [ ] Add custom tests for your features
- [ ] Integrate into CI/CD pipeline

**You're ready to test!** 🚀
