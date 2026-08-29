# Technology Stack

## Runtime & Framework
- **Runtime**: Node.js (LTS)
- **Framework**: Next.js 16.2.9 (App Router)
- **Language**: TypeScript 6
- **Package Manager**: npm
- **React**: React 19.2.8

## Database & Storage
- **Database**: PostgreSQL (Neon serverless)
- **ORM**: Prisma 6.19.2
- **Client**: @prisma/client 6.19.2
- **Caching**: Redis (Upstash) - serverless REST API
- **File Storage**: Vercel Blob
- **Offline Storage**: IndexedDB via Dexie 4.4.5

## Authentication & Security
- **Provider**: NextAuth.js
- **Strategies**: Google OAuth + WebAuthn passkeys; Apple Sign-In on iOS
- **Adapter**: @next-auth/prisma-adapter
- **Encryption**: Node.js crypto (AES-256-GCM for AI credentials; legacy AES-256-CBC rows still readable)
- **Rate Limiting**: Custom implementation with IP/user tracking

## Testing Stack
- **Unit Tests**: Vitest 4.1.10
- **E2E Tests**: Playwright 1.62.1
- **Test Environment**: jsdom 29.1.1
- **Test Utilities**: React Testing Library 16.3.2

## UI & Styling
- **Styling**: Tailwind CSS 3.4.17
- **Components**: Radix UI primitives (Shadcn/ui)
- **Icons**: Lucide React 0.454.0
- **Forms**: React Hook Form 7.85.0 + Zod 3.25.76

## Build & Development
- **Bundler**: Next.js built-in (Turbopack in dev)
- **ESLint**: ESLint 9.39.5
- **TypeScript**: Strict mode
- **PostCSS**: autoprefixer 10.5.4

## AI & Automation
- **OpenAI SDK**: OpenAI 5.15.0
- **Anthropic**: Claude API (Sonnet, Opus)
- **Google**: Gemini API
- **GitHub Copilot**: Official `@github/copilot-sdk` with per-user GitHub OAuth
- **MCP**: Model Context Protocol for external tools
- **GitHub Integration**: Octokit for repository access

## Email & Notifications
- **Outbound Email**: Resend 6.20.0
- **Inbound Email**: Cloudflare Email Workers / Mailgun / Resend webhooks
- **Email Parsing**: TurndownService (HTML to Markdown)
- **Push Notifications**: web-push 3.6.7 (VAPID-based)

## Real-Time & Background Jobs
- **SSE**: Server-Sent Events for real-time updates
- **WebSockets**: Not used (SSE preferred for simplicity)
- **Cron Jobs**: Vercel Cron (every minute)
- **Background Processing**: Offline sync queue in IndexedDB

## Hosting & Infrastructure
- **Platform**: Vercel (serverless)
- **Database**: Neon (serverless PostgreSQL)
- **Redis**: Upstash (serverless Redis)
- **File Storage**: Vercel Blob
- **CDN**: Vercel Edge Network
- **SSL**: Automatic HTTPS via Vercel
