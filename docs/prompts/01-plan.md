# Planning Template

## Project Context
- **Stack**: Use the current versions in [`docs/context/stack.md`](../context/stack.md)
- **Architecture**: App Router API routes, Prisma ORM, database-stored sessions
- **Testing**: Vitest with jsdom, React Testing Library, comprehensive mocks

## Planning Requirements

### Scope Definition
- **Objective**: Clearly state what we're building or changing
- **Success Criteria**: Define measurable outcomes
- **Constraints**: Note any limitations or requirements

### Technical Approach
- **Architecture**: How does this fit into existing patterns?
- **Data Flow**: What changes to database, API, or UI?
- **Dependencies**: What external services or libraries are involved?

### Implementation Plan
- **Phase 1**: Core functionality
- **Phase 2**: Integration and testing
- **Phase 3**: Polish and documentation

## Development Rules

### Code Quality
- **Diff Limit**: Keep changes ≤ 120 lines per file
- **Testing**: All behavior changes require tests
- **Type Safety**: Full TypeScript coverage required

### File Boundaries
- **Touch Only**: Specify exact paths to modify
- **Examples**: `app/api/tasks/route.ts`, `components/task-form.tsx`, `lib/date-utils.ts`
- **Preserve**: Don't change unrelated files

### Documentation
- **Cite file:line before changing code**
- **Update API contracts** if endpoints change
- **Update tests** for new functionality

## Pre-Implementation Checklist
- [ ] Scope clearly defined
- [ ] Technical approach documented
- [ ] File boundaries specified
- [ ] Testing strategy planned
- [ ] Rollback plan considered