# Testing Strategy

## Test Stack & Configuration
- **Test Runner**: Vitest
- **Test Environment**: jsdom
- **Test Utilities**: React Testing Library
- **Test Setup**: `tests/setup.ts` with comprehensive mocks

Exact dependency versions are maintained in [the canonical stack reference](./stack.md)
and verified against [`package.json`](../../package.json) by `npm run check:docs`.

## Test Location & Organization
```
tests/
├── api/           # API route tests (tasks, lists, invitations)
├── auth/          # Authentication & rate limiting tests
├── components/    # Component tests
├── lib/           # Utility function tests (date-utils)
├── setup.ts       # Global test setup & mocks
└── test-utils.tsx # Custom render with providers
```

## Running Tests

### Commands (`package.json:32-34`)
```bash
npm run test          # Run tests in watch mode
npm run test:run      # Run tests once
npm run test:ui       # Run tests with UI
npm run test:coverage # Run tests with coverage
npm run test:rate-limit # Run specific rate limit test
```

### Vitest Configuration (`vitest.config.ts:1-18`)
- **Environment**: jsdom for DOM simulation
- **Setup Files**: `./tests/setup.ts` for global mocks
- **Aliases**: `@/*` path resolution for imports
- **React Plugin**: Full React component support

## Testing Policy

### Unit vs Integration
- **Unit Tests**: Individual functions, utilities, and components (`tests/lib/date-utils.test.ts`)
- **API Tests**: Route handlers with mocked dependencies (`tests/api/tasks.test.ts`)
- **Auth Tests**: Authentication logic and rate limiting (`tests/auth/authentication.test.ts`)
- **Component Tests**: React components with mocked context (`tests/components/`)

### When to Add Tests
- **New Features**: Test all new API endpoints and components
- **Bug Fixes**: Add regression tests for fixed bugs
- **Critical Paths**: Authentication, data validation, error handling
- **Utilities**: Date parsing, permission checks, rate limiting

### Regression Testing
- **API Changes**: Test affected endpoints after schema changes
- **Auth Updates**: Verify authentication flows still work
- **Component Refactors**: Ensure UI behavior remains consistent
- **Database Changes**: Test queries after migration updates

## Test Helpers & Utilities

### Global Setup (`tests/setup.ts:1-137`)
- **NextAuth Mocks**: Complete authentication system mocking
- **Prisma Mocks**: Database client mocking for unit tests
- **Environment Variables**: Test-specific configuration
- **DOM Mocks**: window.matchMedia and browser APIs

### Custom Render (`tests/test-utils.tsx:1-21`)
```typescript
// Wraps components with necessary providers
const customRender = (ui, options) => render(ui, { 
  wrapper: AllTheProviders, 
  ...options 
})
```

### Mock Exports
- **mockPrisma**: Mocked Prisma client for database operations
- **mockGetServerSession**: Mocked NextAuth session for API tests
- **External Service Mocks**: OpenAI, bcryptjs, email services

## Testing Patterns

### API Route Testing (`tests/api/tasks.test.ts:1-100`)
```typescript
// Test route handlers directly with mocked dependencies
const response = await GET()
expect(response.status).toBe(200)
expect(mockPrisma.task.findMany).toHaveBeenCalledWith(...)
```

### Authentication Testing (`tests/auth/authentication.test.ts:1-100`)
```typescript
// Test rate limiting and auth logic
const result = rateLimiter.check(token, maxRequests)
expect(result.success).toBe(true)
expect(result.remaining).toBe(4)
```

### Component Testing
- **Provider Wrapping**: Use `customRender` for context-dependent components
- **Mock Data**: Consistent test data structures across tests
- **User Interactions**: Simulated form submissions and user actions

## Mock Strategy

### Database Mocking
- **Prisma Client**: Mocked in `tests/setup.ts:35-55`
- **No Test Database**: All tests use mocked Prisma operations
- **Realistic Data**: Mock responses match actual database schema

### External Service Mocking
- **NextAuth**: Complete authentication system mocking
- **OpenAI**: Mock image generation responses
- **Email Services**: Mock email sending operations
- **File Operations**: Mock file upload and storage

### Test Isolation
- **Mock Reset**: `vi.clearAllMocks()` in `beforeEach` (`tests/api/tasks.test.ts:25`)
- **Independent Tests**: No test dependencies or shared state
- **Clean Environment**: Fresh mocks for each test case