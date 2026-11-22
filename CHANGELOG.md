# Changelog

All notable changes to Astrid will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Projects state goals and guardrails. The board shows them to everyone, owners and admins edit them in Project settings, and every agent path carries them as untrusted guidance: prompts, the task payload, the agent queue (one entry per list) and the MCP tool `get_project_goals`. Agents cannot change them (ADEV-179, ADEV-190). One additive migration.
- Board Done column: newest-completed first, a "✓ on Nov 19" date on each card, and a "15 ✓ This week" period picker that filters the cards and the count (ADEV-133).
- The board follows the list's live Sort & Filters (ADEV-145).
- The task details panel follows a card that changes column (ADEV-177).
- Completed tasks open with their completion history showing (ADEV-129).
- Release images are multi-arch, linux/amd64 and linux/arm64, each built natively with its own SBOM and provenance (ADEV-125). 1.4.0 and earlier are amd64 only.
- The stock Astrid apps can sign in to a partner's server: `/auth/desktop` accepts the stock `astrid` scheme alongside the brand's own, and `GET /api/v1/capabilities` reports `meta.apiLevel` (ADEV-124).
- A daily check, and a release's last job, confirm that the image tag SELF_HOSTING.md documents exists on GHCR (ADEV-126).
- The SDK runner's prompt carries the task's list instructions and project goals from the queue (ADEV-186).
- MCP `gather_decision_evidence` gives an agent the brief for filling a decision's traffic light with sourced cells, using the project's goals as criteria (ADEV-181).

### Changed
- Trade-off grids follow the Extreme Clarity method: `++` reads **Decisive** and `--` **Disqualifying** (both a high bar), and agents are taught to lead with the recommendation, include a Do nothing row, keep cells concrete and never add a score column (ADEV-178).
- Shared labels say To-do / Done (ADEV-173, ADEV-174).
- A completed task shows the checked checkbox whoever holds it (ADEV-147); the options sheet's "Mark as done" row shows the task's own checkbox, and confirming someone else's task is a line with Cancel and Complete (ADEV-146, 148, 158).
- One confirm dialog replaces the hand-built confirms (ADEV-159).
- The board reads core's board, pill and surface tokens, and both boards draw one shared card and column (ADEV-153, 156, 157, 168, 171).
- Project boards show Waiting first and label the Inbox column "Ideas/Inbox" (ADEV-132, ADEV-137).

- The board's Done period now owns the Done column: "This week", "This month" and "All time" reach past the list's recently-completed window, which bounds the list view only (ADEV-191).

## [1.4.0] - 2026-11-18

One image, many brands: the published image reads its brand when it starts, so a partner mounts a profile instead of building their own image.
Upgrade: back up, pull `:1.4.0` and `:1.4.0-migrator`, run the migrator, roll the app (docs/deployment/SELF_HOSTING.md). The seven new migrations only add tables, columns and indexes. Read **Upgrade notes** below first.

### Upgrade notes
- Self-host compose publishes the app on `127.0.0.1` only (ADEV-105). If you reach port 3000 from another machine without `--profile tls`, set `APP_BIND=0.0.0.0`.
- Clients that read public lists' tasks through an unscoped `GET /api/v1/tasks` must now pass `?listId=` (see Changed).

### Added
- Runtime brand profiles: mount a profile and set `BRAND_PROFILE` (and `BRAND_ASSETS_DIR` for artwork); every brand value, `NEXT_PUBLIC_*` included, is read at start-up (AWTD-1587). Self-host CI proves a mounted brand on an unbranded image (AWTD-1606).
- `npm run brand:launch <profile>`: from a profile to a smoke-tested deployment (AWTD-1590). Every icon is generated from one source icon (AWTD-1588); profiles accept `windows`, `android`, `vscode` and `code` blocks and are checked against the shared brand schema (AWTD-1589).
- The first account on a fresh instance becomes admin once its email is verified, and `REGISTRATION_ALLOWED_EMAIL_DOMAINS` limits who can sign up (ADEV-104).
- Agents: atomic task claims with leases over MCP and the SDK (AWTD-1557), a stored per-board orchestration policy for merge, deploy, migrate, release and spend, and handoffs that return to the assignee.
- Copilot works against a self-hosted instance and a third-party board, with an optional event wake (`repository_dispatch`) alongside the 30-minute poll (ADEV-101, ADEV-102). Guide: docs/deployment/COPILOT_SELF_HOSTED.md.
- The self-host smoke test checks MCP, the job worker, live updates (SSE) and the agent queue (ADEV-105, ADEV-99).
- Lists can be created inside a project; project board view; per-user locale.

### Changed
- `GET /api/v1/tasks` and `GET /api/tasks` without `listId` no longer include tasks from public lists the caller does not own, belong to, or have a task assigned in. Public lists are still read with `?listId=`. Clients that relied on the unscoped read for public tasks (iOS, Windows, Android sync) must fetch them by `listId`.
- Hosted `/mcp` calls its own instance (`ASTRID_API_BASE_URL`, else the `NEXTAUTH_URL` origin) instead of the brand domain, so a self-hosted instance no longer forwards a client's token elsewhere (ADEV-99).
- The reference brand profiles turn off the www redirect and enable Copilot; acme enables MCP (ADEV-97).
- A partner with no operator or support address set inherits none of Astrid's (AWTD-1640); legal pages name the brand's operator (AWTD-1584).
- The Azure template runs the job worker by default and its guide matches the runtime-brand image (ADEV-100). Documented image tags agree, and a test keeps them so (ADEV-98).
- 26 unused dependencies removed (AWTD-1593).

### Fixed
- Sign-in silently failed when the instance's address was outside the brand domain: the session cookie is now host-only there (ADEV-96).
- The root 404 renders per request in a runtime-brand image (AWTD-1599).

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
