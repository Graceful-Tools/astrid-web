# Changelog

## [0.2.0] - 2026-02-17

### Changed

- Converted from ESM to CommonJS for OpenClaw plugin compatibility
- Updated exports to use `require` instead of `import` as primary entry point
- All `.js` output now uses CommonJS `module.exports` / `require()` syntax

## [0.1.0] - 2026-02-16

### Added

- OpenClaw channel plugin wrapping `@gracefultools/astrid-sdk` v0.8.0
- `AstridOpenClawChannel` class with OpenClaw lifecycle (start/send/stop)
- Task completion support via SDK REST client
- Plugin manifest (`openclaw.plugin.json`) for OpenClaw discovery
- Re-exports of SDK channel types and utilities

### Architecture

- Thin wrapper — all message formatting, SSE, OAuth, and session management delegated to the SDK
- No duplicate type definitions; all types imported from `@gracefultools/astrid-sdk`
