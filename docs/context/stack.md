# Technology Stack

## Runtime & Framework
- **Runtime**: Node.js (LTS)
- **Framework**: Next.js 15.5.0 (App Router)
- **Language**: TypeScript 5
- **Package Manager**: npm
- **React**: 19.0.0

## Database & Storage
- **Database**: PostgreSQL (Neon serverless)
- **ORM**: Prisma 6.14.0
- **Client**: @prisma/client 6.14.0
- **Caching**: Redis (Upstash) - serverless REST API
- **File Storage**: Vercel Blob
- **Offline Storage**: IndexedDB via Dexie 4.0.1

## Authentication & Security
- **Provider**: NextAuth.js (latest)
- **Strategies**: Google OAuth + WebAuthn passkeys; Apple Sign-In on iOS
- **Adapter**: @next-auth/prisma-adapter
- **Encryption**: Node.js crypto (AES-256-CBC)
- **Rate Limiting**: Custom implementation with IP/user tracking

## Testing Stack
- **Unit Tests**: Vitest 3.2.4
- **E2E Tests**: Playwright 1.56.0
- **Test Environment**: jsdom 26.1.0
- **Test Utilities**: React Testing Library 16.3.0

## UI & Styling
- **Styling**: Tailwind CSS 3.4.17
- **Components**: Radix UI primitives (Shadcn/ui)
- **Icons**: Lucide React 0.454.0
- **Forms**: React Hook Form 7.54.1 + Zod 3.24.1

## Build & Development
- **Bundler**: Next.js built-in (Turbopack in dev)
- **ESLint**: eslint 8.57.1
- **TypeScript**: Strict mode
- **PostCSS**: autoprefixer 10.4.20

## AI & Automation
- **OpenAI**: 5.15.0 (GPT-4, GPT-3.5)
- **Anthropic**: Claude API (Sonnet, Opus)
- **Google**: Gemini API
- **MCP**: Model Context Protocol for external tools
- **GitHub Integration**: Octokit for repository access

## Email & Notifications
- **Outbound Email**: Resend 4.0.1
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