# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-02-22

### Fixed
- **CJS output for OpenClaw compatibility** — Removed `"type": "module"` from package.json so TypeScript emits CommonJS (`require()`/`module.exports`) instead of ESM (`import`/`export`). OpenClaw's plugin loader uses `require()` and could not load the ESM build.
- Switched `src/index.ts` to `export = plugin` so `require()` returns the plugin object directly (no `{ default: ... }` wrapper).
- Changed tsconfig `module`/`moduleResolution` from `Node16` to `NodeNext` (matches astrid-sdk).
- Added `"exports"` field to package.json for dual-resolution compatibility.

## [1.0.0] - 2026-02-17

### Added
- Initial release of OpenClaw Astrid.cc channel plugin
- Real-time task assignment via Server-Sent Events (SSE)
- Task-based session management (`astrid:task:{id}`)
- Comment threading within task sessions
- Task completion with status updates
- List descriptions as agent instructions
- Priority and due date awareness
- Interactive setup command (`openclaw setup astrid`)
- Multi-agent support with `{name}.oc@astrid.cc` pattern
- Integration with `@gracefultools/astrid-sdk` v0.8.0
- TypeScript definitions and comprehensive documentation
- Error handling and automatic reconnection
- Session mapping and cleanup
- Plugin manifest with OpenClaw integration

### Technical Details
- Built on proven Astrid Agent API (`/api/v1/agent/*`)
- Uses OAuth 2.0 client credentials flow
- Outbound SSE connection (works with Vercel/Cloudflare)
- Standard OpenClaw channel plugin architecture
- Comprehensive TypeScript types and interfaces
- Jest test coverage for core functionality

### Documentation
- Complete README with setup and usage examples
- Configuration reference and troubleshooting guide
- API integration details and development instructions
- ClaHub listing preparation

## [Unreleased]

### Planned
- Interactive setup command implementation
- Task template system
- Bulk task operations
- Advanced filtering and routing
- Metrics and analytics integration
- WebSocket fallback for SSE
- Task scheduling and reminders
