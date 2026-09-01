# AI Edits Policy

The authoritative coding workflow is [ASTRID.md](../../ASTRID.md). Local command,
quality-gate, deployment, and OAuth behavior belongs in
[CLI operations](../CLI_OPERATIONS.md). This document adds no competing command
or policy definitions.

## Code Quality Standards

### Smallest Safe Diff Policy
- **Minimal Changes**: Make the smallest possible change that achieves the goal
- **Single Responsibility**: Each edit should address one specific issue or feature
- **Context Preservation**: Maintain existing code structure and patterns
- **Incremental Approach**: Break large changes into smaller, reviewable edits

### Testing Requirements
- **Behavior Changes**: All functional changes must include corresponding tests
- **New Features**: Add tests for new API endpoints, components, and utilities
- **Bug Fixes**: Include regression tests to prevent recurrence
- **Test Coverage**: Maintain or improve existing test coverage levels

## Security & Best Practices

### Never Expose Secrets
- Follow the repository-wide [security policy](../../SECURITY.md).
- Never commit API keys, credentials, database URLs, OAuth secrets, or local
  environment files.

### Code Review Standards
- **Self-Review**: Review your own changes before requesting review
- **Clear Descriptions**: Explain the purpose and approach of each change
- **Documentation Updates**: Update relevant documentation when changing APIs or behavior
- **Breaking Changes**: Clearly document any breaking changes with migration steps

### Documentation Maintenance
- **Architecture Changes**: Update `docs/ARCHITECTURE.md` when adding new components or changing system design
- **Layout/UI Changes**: Update `docs/LAYOUT_SYSTEM.md` when modifying responsive behavior or component patterns
- **API Changes**: Update the authoritative [`docs/API_CONTRACT.md`](../API_CONTRACT.md)
  when a stable external/mobile contract changes
- **New Patterns**: Add discovered patterns to `docs/context/conventions.md`
- **Review Helper**: Use `npm run docs:review` to identify which docs may need updates after changes

## Development Workflow

### Commit Guidelines
- **Descriptive Messages**: Use clear, action-oriented commit messages (`VERCEL_SETUP.md:35`)
- **Feature Branches**: Create feature branches for significant changes
- **Atomic Commits**: Each commit should represent a complete, working change
- **Reference Issues**: Link commits to relevant issues or documentation

### Pre-commit Checks

Use the gate selected by
[`docs/CLI_OPERATIONS.md` §4](../CLI_OPERATIONS.md#4-quality-gates); do not copy
its mutable command composition here.

## Repository-Specific Rules

### Database Changes
- **Schema Updates**: Test migrations locally before committing.
- **Production Safety**: Follow the deployment and migration rules in
  [CLI operations](../CLI_OPERATIONS.md#0-deployment-the-one-rule-that-matters).
- **Rollback Plan**: Always have a rollback strategy for schema changes

### API Changes
- **Backward Compatibility**: Maintain API compatibility when possible
- **Validation**: Add input validation for new endpoints
- **Error Handling**: Use consistent error response patterns
- **Documentation**: Update API contracts when endpoints change

### Frontend Changes
- **Component Consistency**: Follow existing component patterns and naming
- **Theme Support**: Ensure changes work with both light and dark themes
- **Responsive Design**: Test changes on mobile and desktop
- **Accessibility**: Maintain or improve accessibility standards