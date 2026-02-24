# Contributing to Astrid

Thank you for your interest in contributing to Astrid! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Repository Structure

Astrid consists of two separate repositories:

| Repository | Contents | Purpose |
|------------|----------|---------|
| `Graceful-Tools/astrid-web` | Next.js web app + API backend + SDK | Web frontend and API server |
| `Graceful-Tools/astrid-ios` | SwiftUI iOS app | Native iOS client |

This file covers contributing to the **web repository**. For iOS contributions, see the [astrid-ios CONTRIBUTING guide](https://github.com/Graceful-Tools/astrid-ios/CONTRIBUTING.md).

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ (or SQLite for local development)
- Redis (optional, for caching)

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/astrid-web.git
   cd astrid-web
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your configuration
   ```

   **Minimum required for tests:**
   ```bash
   # .env.local
   NEXTAUTH_SECRET=any-secret-for-testing
   NEXTAUTH_URL=http://localhost:3000
   ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
   ```

   **For full local development (with database):**
   ```bash
   # PostgreSQL connection string
   DATABASE_URL=postgresql://user:password@localhost:5432/astrid_dev

   # Google OAuth (optional, for sign-in)
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   ```

   > **Note:** Tests run with mocked database by default. You only need PostgreSQL for running the full app locally.

4. **Set up the database**
   ```bash
   npm run db:generate
   npm run db:push
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

## How to Contribute

### Reporting Bugs

Before submitting a bug report:
- Check existing issues to avoid duplicates
- Use the bug report template when available
- Include steps to reproduce, expected behavior, and actual behavior
- Include your environment details (OS, Node version, browser)

### Suggesting Features

- Check existing issues and discussions first
- Describe the problem your feature would solve
- Consider the scope and impact on existing functionality

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Follow coding standards** (see below)
3. **Write tests** for new functionality
4. **Update documentation** as needed
5. **Ensure all tests pass**: `npm run predeploy`
6. **Submit your PR** with a clear description

### Contributor Git Workflow

**Initial Setup (one-time):**

```bash
# Fork the repo on GitHub, then clone your fork
git clone git@github.com:YOUR-GITHUB-ID/astrid-web.git
cd astrid-web

# Add upstream remote to track the main repo
git remote add upstream git@github.com:Graceful-Tools/astrid-web.git
```

**Working on new features/fixes:**

```bash
# Start from a fresh branch based on upstream main
git fetch upstream
git checkout -b my-new-feature upstream/main

# Work on your changes...
# Make separate commits for each logical change:
# - One commit per bug fix
# - One commit per feature
# - One commit for style/formatting changes
# - One commit for copy/documentation edits

git add .
git commit -m "feat(scope): description of change"

# Before pushing, sync with upstream and clean up commits
git fetch upstream
git rebase -i upstream/main
# Use rebase -i to:
# - Verify what you're committing
# - Squash small/fixup commits together
# - Ensure clean commit history

# Push to your fork
git push origin HEAD

# Go to GitHub and open a Pull Request!
```

**Keeping your fork up to date:**

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

### Coding Standards

- **TypeScript**: Use strict typing; avoid `any` when possible
- **Formatting**: Code is auto-formatted with ESLint
- **Naming**: Use camelCase for variables/functions, PascalCase for components/types
- **Comments**: Add JSDoc for public functions; explain complex logic inline
- **Tests**: Write tests for new features and bug fixes

### Commit Messages

Follow conventional commits format:
```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
```
feat(tasks): add recurring task support
fix(auth): handle expired session tokens
docs(api): update authentication examples
```

## Development Workflow

### Running Tests

```bash
# Run all tests
npm run test

# Run unit tests only
npm run test:run

# Run E2E tests
npm run test:e2e

# Run with coverage
npm run test:coverage
```

### Quality Checks

```bash
# Quick check (TypeScript + lint)
npm run predeploy:quick

# Full check (tests + type check + lint)
npm run predeploy
```

### Database Migrations

```bash
# Create a migration
npx prisma migrate dev --name your-migration-name

# Apply migrations
npx prisma migrate deploy
```

## Project Structure

```
astrid/
├── app/              # Next.js App Router pages and API routes
├── components/       # React components
├── hooks/            # Custom React hooks
├── lib/              # Utility functions and services
├── prisma/           # Database schema and migrations
├── tests/            # Test files
└── types/            # TypeScript type definitions
```

## Questions?

- Open a [Discussion](https://github.com/your-org/astrid/discussions) for questions
- Check the [documentation](./docs/README.md) for guides
- Review existing issues for similar questions

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
