# Astrid Documentation

This directory contains the active technical documentation for Astrid. Historical
snapshots live under `archive/` and are not current operating instructions.

## Authoritative documentation owners

Each mutable domain has one owner. Other active documents should link to that owner
instead of restating values, commands, or policy.

| Domain | Authoritative owner | Scope |
|---|---|---|
| Architecture | [Architecture](./ARCHITECTURE.md) | Current system boundaries and runtime design |
| Local operations | [CLI operations](./CLI_OPERATIONS.md) | Deploy, quality-gate, OAuth, and task-management commands |
| API contracts | [API contract](./API_CONTRACT.md) | Stable external and mobile wire contract |
| Testing | [Testing strategy](./context/testing.md) | Test policy, locations, and selection |
| Security | [Security policy](../SECURITY.md) | Reporting policy and repository-wide security requirements |
| Product behavior | [Product contract](./PRODUCT_CONTRACT.md) | Cross-platform permissions, behavior, and shared copy |

`package.json`, workflow files, Prisma schema, and code remain the executable sources
of truth. Documentation checks validate links, canonical headings, index ownership,
and stack versions with `npm run check:docs`.

## 📚 Documentation Index

### 🏗️ Core Architecture
- **[Architecture Overview](./ARCHITECTURE.md)** - System architecture and design patterns
- **[Authentication System](./AUTHENTICATION.md)** - Authentication implementation and security
- **[Offline Mode](./OFFLINE_MODE.md)** - Offline-first architecture with IndexedDB and background sync
- **[Agent Architecture Simplification](./AGENT_ARCHITECTURE_SIMPLIFICATION.md)** - Simplified AI agent system (tools-based, multi-provider)
- **[Agent Polling Mode](./AGENT_POLLING_MODE.md)** - Let a user's own harness (Claude Code, Codex, Copilot, Gemini) work the agent's queue on a loop instead of Astrid calling a provider API

### 🎨 Whitelabeling
- **[Whitelabeling Guide](./WHITELABELING.md)** - ⭐ Deploy under a different brand, with a different set of back-end services, entirely through build-time configuration
- **[Brand Profiles](../brands/README.md)** - Per-partner profiles and the brand-matrix tests

### 🚀 Setup & Deployment
- **[Auth Setup](./setup/AUTH_SETUP.md)** - Authentication configuration
- **[Database Setup](./setup/DATABASE_SETUP.md)** - Database configuration and migrations
- **[Email Setup](./setup/EMAIL_SETUP.md)** - Email service configuration and overview
- **[Cloudflare Email Setup](./setup/CLOUDFLARE_EMAIL_SETUP.md)** - Complete Cloudflare email routing setup
- **[Cloudflare Email Quickstart](./setup/CLOUDFLARE_EMAIL_QUICKSTART.md)** - Quick reference for Cloudflare email
- **[Cloudflare + Resend Status](./setup/CLOUDFLARE_RESEND_STATUS.md)** - Current email system status and SPF configuration
- **[Vercel Setup](./setup/VERCEL_SETUP.md)** - Deployment to Vercel
- **[Deployment Guide](./setup/DEPLOYMENT_GUIDE.md)** - General deployment instructions

### 🤖 AI Agents & Automation
- **[AI Workflow Review](./AI_WORKFLOW_REVIEW.md)** - Recommended paved paths for Claude Code, GitHub Copilot, Codex, server-run agents, and Custom Agents
- **[CLAUDE.md](../CLAUDE.md)** - ⭐ **Essential**: Claude Code operational context (root)
- **[CODEX.md](../CODEX.md)** - OpenAI Codex operational context (root)
- **[ASTRID.md Template](./templates/ASTRID.md)** - ⭐ **Essential**: Configure AI agent behavior for your project
- **[AI Agents Overview](./ai-agents/README.md)** - Getting started with AI coding agents
- **[Quick Start Guide](./ai-agents/quick-start.md)** - Fast setup for AI agents
- **[Setup Checklist](./ai-agents/setup-checklist.md)** - Complete setup verification
- **[GitHub Integration](./ai-agents/GITHUB_CODING_AGENT_IMPLEMENTATION.md)** - Detailed implementation guide
- **[Example Tasks](./ai-agents/example-tasks.md)** - Sample tasks for AI agents
- **[Troubleshooting](./ai-agents/troubleshooting.md)** - Common issues and solutions
- **[Weekly Hygiene Review](./WEEKLY_HYGIENE_REVIEW.md)** - Scheduled review that files hygiene/security/perf tasks to the Astrid board

### 🧪 Testing & Quality
- **[MCP Testing Guide](./testing/MCP_TESTING_GUIDE.md)** - Complete MCP (Model Context Protocol) testing
- **[E2E Testing Quickstart](./testing/E2E_QUICKSTART.md)** - Quick reference for end-to-end testing
- **[Playwright Setup](./testing/PLAYWRIGHT_SETUP.md)** - Playwright installation and configuration
- **[Playwright Auth Guide](./testing/PLAYWRIGHT_AUTH_GUIDE.md)** - Authentication testing with Playwright
- **[MCP Servers](../mcp/README.md)** - Standalone MCP server implementations and build scripts
- **[Development Guidelines](./guides/development-guidelines.md)** - Code quality and development standards

### 🏛️ System Context
- **[Stack Overview](./context/stack.md)** - Technology stack and dependencies
- **[Active Script Inventory](./SCRIPT_INVENTORY.md)** - Reproducible ownership/caller classification for top-level scripts
- **[Conventions](./context/conventions.md)** - Code and naming conventions
- **[Quick Reference](./context/quick-reference.md)** - Common commands and patterns
- **[Testing Strategy](./context/testing.md)** - Testing approach and tools
- **[Task Defaults System](./context/task-defaults-system.md)** - Task default values and behavior

### 🎨 UI & Design
- **[Layout System](./LAYOUT_SYSTEM.md)** - ⚠️ **Critical**: Mobile vs Column Layout distinction, responsive breakpoints

### 💬 Chat & Messaging
- **[iOS Chat API Spec](./ios/IOS_CHAT_API_SPEC.md)** - Full chat API integration spec for iOS (channels, messages, attachments, typing indicators)
- **[API Contract](./API_CONTRACT.md)** - Authoritative mobile/external API contract, including chat endpoints and SSE events

### 📱 Related: iOS App
The native iOS app is maintained in a separate repository:
- **Repository:** https://github.com/Graceful-Tools/astrid-ios
- **iOS Documentation:** See the iOS repository for development guides and architecture

### 🔒 Security & Files
- **[Security Policy](../SECURITY.md)** - Vulnerability reporting and engineering requirements
- **[Authentication System](./AUTHENTICATION.md)** - Authentication-specific implementation details

### 🤖 AI Prompts
- **[Planning Mode](./prompts/01-plan.md)** - AI planning prompts
- **[Multi-file Refactor](./prompts/02-multi-file-refactor.md)** - Large refactoring prompts
- **[Reviewer Mode](./prompts/03-reviewer-mode.md)** - Code review prompts
- **[PR Author](./prompts/04-pr-author.md)** - Pull request creation prompts
- **[Bug Hunt](./prompts/05-bug-hunt.md)** - Bug finding and fixing prompts

### 🔧 Fixes & Troubleshooting
- **[iOS Timezone Date Handling Fix](./fixes/IOS_TIMEZONE_DATE_HANDLING_FIX.md)** - ⚠️ **Critical**: API date/time handling patterns for mobile clients
- **[Insecure Connection Warnings Fix](./fixes/INSECURE-CONNECTION-WARNINGS-FIX.md)** - Resolving HTTPS connection warnings
- **[Local Testing Guide](./fixes/LOCAL_TESTING_GUIDE.md)** - Guide for testing locally
- **[AI Agent Consolidation Analysis](./fixes/AI_AGENT_CONSOLIDATION_ANALYSIS.md)** - Analysis of AI agent system

### 📦 Archive
The `archive/` directory contains historical documentation preserved for reference:
- **Implementation Summaries** (`archive/implementations/`)
  - OAuth implementation phases (Phase 1, Phases 2 & 3)
  - Repository access and workflow fixes (2024-09/10)
  - Connection and webhook payload fixes
  - SSE consolidation and retry logic
  - Playwright integration and migration details
  - Admin member migration and datetime refactor
  - iOS OAuth and API v1 migration
  - MCP to API migration plans
- **Analysis Documents** (`archive/analysis/`)
  - Cloud workflow analysis and comparisons
  - Historical architectural decisions
- **Completed Migrations** (`archive/completed-migrations/`)
  - Secure file migration
  - AI agent schema proposals and migration plans
  - Astrid.md production checklist
- **Legacy Documentation**
  - Migration guides and safety reports
  - Old optimization trackers
  - Previous system designs

## 🎯 Quick Start

### For Developers
1. Start with [Architecture Overview](./ARCHITECTURE.md)
2. Follow [Setup & Deployment](#-setup--deployment) guides
3. Review [Development Guidelines](./guides/development-guidelines.md)

### For AI Agent Setup
1. Read [AI Agents Overview](./ai-agents/README.md)
2. Follow [Quick Start Guide](./ai-agents/quick-start.md)
3. Complete [Setup Checklist](./ai-agents/setup-checklist.md)

### For Testing MCP Integration
1. Review [MCP Testing Guide](./testing/MCP_TESTING_GUIDE.md)
2. Test with the interactive web UI at `/settings/mcp-testing`

*For questions or documentation updates, please create an issue or reach out to the development team.*