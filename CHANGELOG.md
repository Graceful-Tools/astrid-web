# Changelog

All notable changes to Astrid will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-11-01

First release published as a container image (`ghcr.io/graceful-tools/astrid-web:1.3.0` and `:1.3.0-migrator`).
Upgrade: back up, pull, run the migrator, roll the app (docs/deployment/SELF_HOSTING.md). Migrations are forward-only.

### Added
- Self-hosting backends chosen by env, one code path: `EMAIL_TRANSPORT=smtp`, `STORAGE_DRIVER=azure-blob`, `REALTIME_BUS=redis`, and `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` / `GEMINI_BASE_URL` (Azure OpenAI supported)
- Azure deployment template (`deploy/azure/`) and guide (docs/deployment/AZURE.md)
- Durable job queue (`Job` table): Astrid replies and post-save work are retried instead of lost; `worker` service for self-host
- Sync cursor: `serverTime` on `GET /api/v1/tasks` and `/api/v1/lists`, and keyset paging with `?cursor=`
- Search trigram indexes on task title, description and comment text
- Nightly history retention for TaskEvent, AnalyticsEvent and Notification (counts only until `HISTORY_RETENTION_PRUNE=delete`)
- Usage counting for the legacy MCP SSE transport, ahead of removing it
- Release workflow publishing container images on `v*` tags
- Centralized logging utility using pino for structured logging
- Admin authentication protection for debug pages

### Fixed
- Digests at times not on the hour (08:30, 17:45) never sent; "today" now uses each person's own calendar day
- Live updates could be dropped between server instances
- Featured and public lists read their own tasks, so they no longer depend on the home task read
- Google sign-in on a partner's own domain no longer detours through the brand domain outside previews
- `/api/health` no longer shows part of a secret webhook URL or raw database errors

### Changed
- The digest pass reads only users who are due, not every user each run
- Saving a task responds sooner: notifications, reminders, stats and dependent-task updates run just after the response
- Vendor SDKs may be imported only from their driver files (ESLint); `check:reuse` is a predeploy gate
- Refactored cached data hooks to use factory pattern, reducing code duplication
- Extracted shared date comparison utilities for better maintainability
- Sanitized documentation for open source release

### Removed
- Nine unused dependencies, and the unused in-memory WorkflowQueue
- Disabled iOS test files that were wrapped in `#if false`
- Internal email references and test credentials from documentation
- Dead code and unused backwards-compatibility exports

## [1.2.0] - 2024-12

### Added
- Apple Reminders sync (two-way synchronization)
- Background timer support for iOS
- DAU/WAU/MAU analytics dashboard with platform breakdown
- App Store download button on sign-in page
- Localization for Apple Reminders and Debug Settings UI
- Missing translations for all supported languages

### Fixed
- iOS: Prevent user data leakage on sign-out
- iOS: Timer countdown continues in background
- iOS: Swift 6 concurrency warnings in TimerBackgroundManager
- iOS: Index out of range crash in QuickLook
- API: Add timerDuration and lastTimerValue to v1 API
- Web: Persist timer duration when user edits it

### Changed
- iOS version bumped to 1.2.0
- Renamed "AI Assistant" settings to "Exploratory Features"
- Analytics: Replace platform pie chart with trend lines
- Legal pages: Simplified privacy policy and terms pages

## [1.1.0] - 2024-11

### Added
- iOS app with SwiftUI
- Real-time sync via Server-Sent Events
- Core Data persistence for offline support
- Task timer functionality
- File attachments with QuickLook preview
- Public lists system with copy functionality

### Fixed
- PDF thumbnail generation after QuickLook markup edit
- White background for QuickLook to prevent flicker

## [1.0.0] - 2024-10

### Added
- Initial release
- Next.js 15 web application
- Task management with lists
- User authentication (Google OAuth + credentials)
- Task sharing and collaboration
- Reminder system with push notifications
- AI coding agent integration
- MCP (Model Context Protocol) support
