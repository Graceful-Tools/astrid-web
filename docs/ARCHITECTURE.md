# Astrid Architecture

## Overview

Astrid is a task management application built with clean separation of concerns using a controller-view pattern with custom React hooks.

## Technology Stack

### Core Framework
- **Next.js 15.5** with App Router
- **TypeScript** + **React 19**
- **Tailwind CSS** + **Shadcn/ui** components (based on Radix UI)

### Backend & Data
- **PostgreSQL** with **Prisma** ORM (hosted on Neon)
- **NextAuth.js** for authentication (Google OAuth + WebAuthn passkeys; Apple Sign-In on iOS)
- **Server-Sent Events (SSE)** for real-time updates
- **Vercel Blob** for file storage
- **Redis** (Upstash) for caching and SSE state management
- **IndexedDB** (Dexie) for offline-first client storage

### AI & Automation
- **Model Context Protocol (MCP)** for external AI tool access
- **AI Coding Agent** with GitHub integration
- Support for Claude, OpenAI, and Gemini APIs
- **AI Orchestration Service** for multi-provider failover

### Email & Notifications
- **Resend** for transactional emails (outbound)
- **Cloudflare Email Workers** / **Mailgun** / **Resend** for inbound email
- **Web Push** (VAPID) for browser notifications
- **Email-to-Task** service (`remindme@astrid.cc`)

### Background Jobs
- **Vercel Cron** for scheduled tasks (runs every minute)
- **Reminder Queue** for task reminders and digests
- **Offline Sync Queue** for mutation reconciliation

### Testing & Development
- **Vitest** for unit and integration testing
- **Playwright** for end-to-end testing
- **ESLint** + **TypeScript** for code quality
- Comprehensive test coverage across components, hooks, and user workflows

## Application Architecture

### Entry Points
```
app/page.tsx → AuthenticatedApp → TaskManager
```

### Core Component Pattern

The main `TaskManager` component uses a clean MVC-style architecture:

```typescript
// TaskManager.tsx
export function TaskManager() {
  // Business logic and data management
  const controller = useTaskManagerController({
    initialSelectedListId,
    listMetadata,
    isMobile: layout.isMobile,
    is1Column: layout.is1Column,
  })

  // Responsive behavior and layout state
  const layout = useTaskManagerLayout({
    onRefresh: controller.loadData
  })

  // Dialog and popup management
  const modals = useTaskManagerModals()

  // Pure presentation component
  return (
    <TaskManagerView
      {...controller}
      {...layout}
      {...modals}
    />
  )
}
```

### Hook Responsibilities

#### `useTaskManagerController`
- **Purpose**: Business logic, state management, API calls
- **Exports**: Task/list data, CRUD operations, computed values
- **Benefits**: Testable in isolation, framework-agnostic

#### `useTaskManagerLayout`
- **Purpose**: Responsive behavior, mobile/desktop differences
- **Exports**: Layout state (`isMobile`, `is1Column`), navigation handlers
- **Benefits**: Platform-specific logic isolated

#### `useTaskManagerModals`
- **Purpose**: Modal and dialog state management
- **Exports**: Modal states and control functions
- **Benefits**: Centralized popup logic

#### `TaskManagerView`
- **Purpose**: Pure presentation layer
- **Props**: All data and handlers from hooks
- **Benefits**: Completely testable with mocked props

## Key Features

### Task Management
- Create, read, update, delete tasks
- Task lists with collaboration and sharing
- Comments with file attachments
- Priority levels and due dates
- Real-time synchronization via SSE

### UI Components

#### Empty State Design
- **AstridEmptyState Component** ([astrid-empty-state.tsx](../components/ui/astrid-empty-state.tsx))
  - Reminders-style empty state with speech bubble UI
  - Contextual messages based on list type (personal, shared, today, my-tasks, etc.)
  - Astrid character illustration with gradient styling
  - Theme-aware with light/dark mode support
  - Subtle animations for engaging user experience
  - Mobile-specific hint arrow for task creation
  - Integrated in [MainContent.tsx](../components/TaskManager/MainContent/MainContent.tsx#L490-L520)

**Contextual Messages by List Type:**
- **Personal Lists**: "Ready to capture your thoughts? Tap below to create your first task!"
- **Shared Lists**: "Start collaborating! Add a task below to get this shared list going."
- **Today**: "Nothing scheduled for today! Enjoy the free time, or add something new below."
- **My Tasks**: "You're all caught up! No tasks assigned to you right now."
- **Public Lists**: "Share your ideas with the world! Add tasks below - anyone can see this public list."
- **Featured Lists**: "This list is empty right now! Copy it to make it your own and start adding tasks."

### AI Integration
- **AI Coding Agent**: Automated code generation and GitHub PR creation
- **MCP Integration**: External AI tools can access tasks via token-based API
- **Multiple AI Providers**: Claude, OpenAI, Gemini support

### Responsive Design
- **Layout System**: 1-column, 2-column, 3-column responsive breakpoints
- **Mobile Optimization**: Touch-friendly interfaces, gesture support
- **Device Detection**: Separate handling for mobile vs desktop interaction patterns

### Authentication & Security
- **NextAuth.js**: Secure authentication with multiple providers
- **Role-Based Access**: Owner/admin/member permissions on lists
- **API Security**: Rate limiting, input validation, CORS protection

## Directory Structure

```
app/                    # Next.js app router (pages, API routes)
├── api/               # API endpoints (tasks, auth, MCP, etc.)
├── (auth)/           # Authentication pages
└── settings/         # User settings pages

components/            # React components (~60+ components)
├── TaskManager.tsx   # Main application component
├── TaskManagerView.tsx # Presentation layer
├── task-detail.tsx   # Task editing interface
└── ui/               # Radix UI base components

hooks/                 # Custom React hooks
├── useTaskManagerController.ts # Business logic
├── useTaskManagerLayout.ts     # Responsive behavior
└── useTaskManagerModals.ts     # Modal management

lib/                   # Utility libraries
├── auth.ts           # Authentication utilities
├── database-utils.ts # Database helpers
└── github-client.ts  # GitHub integration

mcp/                   # Model Context Protocol servers
├── mcp-server-v2.ts  # Current MCP server implementation
└── README.md         # MCP documentation

prisma/               # Database schema and migrations
scripts/              # Utility scripts (70+ automation scripts)
tests/                # Test suites (40+ test files)
```

## Data Flow

### Task Operations
1. **User Action** → `TaskManagerView` component
2. **Event Handler** → `useTaskManagerController` hook
3. **API Call** → `/api/tasks/*` endpoints
4. **Database** → Prisma ORM → PostgreSQL
5. **Real-time Update** → SSE broadcast to connected clients
6. **State Update** → React hook triggers re-render

### Authentication Flow
1. **Login** → NextAuth.js providers (Google OAuth, WebAuthn passkeys, or — on iOS — Apple Sign-In via `/api/auth/apple`)
2. **Session** → JWT stored in secure cookies
3. **API Protection** → Middleware validates sessions
4. **User Context** → Available throughout application

## Testing Strategy

### Component Testing
- **Pure Components**: Test presentation layer with mocked props
- **Hooks**: Test business logic in isolation
- **Integration**: Test complete workflows

### Test Structure
```
tests/
├── components/       # Component unit tests
├── hooks/           # Hook unit tests
├── api/             # API endpoint tests
└── mcp/             # MCP functionality tests
```

## Performance Considerations

### Optimizations
- **SSE with Polling Fallback**: Reliable real-time updates
- **Optimistic Updates**: Immediate UI feedback
- **Component Memoization**: Prevent unnecessary re-renders
- **Lazy Loading**: Code splitting for better initial load

### Caching Strategy

#### **Multi-Layer Caching Architecture**
1. **Browser Cache (Service Worker)**
   - Static assets cached via Service Worker ([public/sw.js](../public/sw.js))
   - Cache-first strategy for static resources (CSS, JS, images)
   - Network-first with cache fallback for API requests
   - Progressive Web App (PWA) support with offline capability
   - Cache versioning: `astrid-static-v1.0.2`, `astrid-dynamic-v1.0.2`

2. **API Key Cache** ([lib/api-key-cache.ts](../lib/api-key-cache.ts))
   - In-memory cache for decrypted AI service API keys (Claude, OpenAI, Gemini)
   - 5-minute TTL to avoid repeated database queries and decryption
   - Automatic cache invalidation on key updates
   - Secure decryption using AES-256-CBC encryption

3. **Redis Cache** ([lib/redis.ts](../lib/redis.ts))
   - Production: Upstash Redis (serverless-friendly REST API)
   - Development: Local Redis server
   - Used for SSE connection management and real-time state
   - Adapter pattern for unified interface across environments

4. **IndexedDB Cache (Offline-First)** ([lib/offline-db.ts](../lib/offline-db.ts))
   - Client-side persistent storage using Dexie (IndexedDB wrapper)
   - Stores tasks, lists, users, comments for offline access
   - Mutation queue for offline operations sync
   - ID mapping for temporary-to-real ID conversion
   - Automatic cleanup of stale data

5. **Database Indexing**
   - Optimized Prisma queries with strategic indexes
   - Composite indexes on frequently queried fields
   - User lookup indexes: `email`, `emailVerified`, `isAIAgent`, `aiAgentType`
   - Task indexes: `listId`, `assignedToId`, `dueDate`, `completed`
   - List indexes: `ownerId`, `privacy`, `isFavorite`

## Offline Mode

### **Offline-First Architecture** ([docs/OFFLINE_MODE.md](./OFFLINE_MODE.md))

Astrid implements a comprehensive offline-first strategy for seamless operation without internet connectivity.

#### **Components**

1. **IndexedDB Storage** ([lib/offline-db.ts](../lib/offline-db.ts))
   - Dexie-based database with versioned schema
   - Tables: `tasks`, `lists`, `users`, `comments`, `publicTasks`
   - Mutation queue: `mutations`, `idMappings`
   - Storage info API for monitoring database size

2. **Offline Sync Manager** ([lib/offline-sync.ts](../lib/offline-sync.ts))
   - Queue-based mutation processing with retry logic
   - Conflict detection and resolution (409 handling)
   - Dependency resolution for parent-child entities
   - Automatic sync on reconnection
   - ID mapping for temporary-to-real ID conversion
   - Max 3 retries with exponential backoff

3. **Service Worker** ([public/sw.js](../public/sw.js))
   - Cache-first strategy for static assets
   - Network-first with cache fallback for API routes
   - Background sync for pending mutations
   - Push notification support

#### **Workflow**

1. **Offline Detection**: Browser `navigator.onLine` status
2. **Local Mutation**: User creates/updates task → Saved to IndexedDB
3. **Queue Operation**: Mutation added to sync queue with temp ID
4. **Optimistic UI**: UI updates immediately with local data
5. **Online Detection**: `online` event fires → Sync begins
6. **Sync Process**:
   - Process mutations in chronological order
   - Resolve parent dependencies (e.g., comment → task)
   - Map temp IDs to real server IDs
   - Update local cache with server response
7. **Conflict Resolution**: Server has newer version → Merge or manual resolution

#### **Testing**
- E2E tests: [e2e/offline.spec.ts](../e2e/offline.spec.ts)
- Unit tests: [tests/lib/offline-sync.test.ts](../tests/lib/offline-sync.test.ts)
- Script: [scripts/check-offline-mutations.ts](../scripts/check-offline-mutations.ts)

## Real-Time Updates

### **Server-Sent Events (SSE) Architecture**

#### **SSE Manager** ([lib/sse-manager.ts](../lib/sse-manager.ts))
- Singleton pattern for single connection per client
- Event routing to multiple subscribers
- Automatic reconnection with exponential backoff
- Heartbeat monitoring (30s timeout)
- Graceful reconnection on page visibility change
- Connection state management and listeners

#### **SSE Server** ([app/api/sse/route.ts](../app/api/sse/route.ts))
- Per-user event streams
- Redis-backed pub/sub for multi-instance support
- Event types: `task_updated`, `task_created`, `task_deleted`, `list_updated`, etc.
- Heartbeat every 15 seconds to keep connection alive
- Automatic cleanup on client disconnect

#### **Broadcast Utility** ([lib/sse-utils.ts](../lib/sse-utils.ts))
- `broadcastToUsers()`: Send events to specific users
- `getListMemberIds()`: Get all members of a list for broadcasting
- Used by API routes to notify all affected users of changes

#### **Event Flow**
1. User performs action (create/update/delete task)
2. API route processes request and saves to database
3. API calls `broadcastToUsers()` with affected user IDs
4. SSE server sends event to all connected clients
5. Client SSE manager receives event and routes to subscribers
6. React components re-render with updated data

## Push Notifications

### **Web Push Architecture** ([lib/push-notification-service.ts](../lib/push-notification-service.ts))

#### **Features**
- VAPID-based push notifications (web-push library)
- Task reminders with due date/time
- Daily digest notifications
- Subscription management (active/inactive)
- Multi-device support
- Custom notification actions (view, snooze, complete)

#### **Subscription Flow**
1. User enables notifications in settings
2. Browser requests notification permission
3. Service Worker creates push subscription
4. Subscription saved to database (`PushSubscription` model)
5. Server can now send notifications to this device

#### **Notification Types**
- **Task Reminder**: "Task due in 15 minutes"
- **Overdue Task**: "Task is overdue"
- **Daily Digest**: Summary of tasks due today/tomorrow

#### **API Endpoints**
- `POST /api/push/subscribe`: Register push subscription
- `POST /api/user/push-subscription`: Manage subscriptions
- `GET /api/debug/test-notifications`: Send test notification

#### **Service Worker Handlers**
- `notificationclick`: Handle notification actions (open, snooze, complete)
- `push`: Receive and display notifications when app is closed

## Email Services

### **Outbound Email** ([lib/email.ts](../lib/email.ts))

#### **Provider: Resend**
- Transactional emails via Resend API
- Smart configuration (production vs development)
- Email verification flow
- List invitation emails
- Task assignment notifications

#### **Email Types**
1. **Invitation Emails**: List invites, task assignments
2. **Verification Emails**: Email change verification
3. **Reminder Emails**: Task due date reminders (via [lib/email-reminder-service.ts](../lib/email-reminder-service.ts))

### **Inbound Email** ([lib/email-to-task-service.ts](../lib/email-to-task-service.ts))

#### **Email-to-Task Service**
- Receive emails at `remindme@astrid.cc`
- Convert emails to tasks automatically
- Support for multiple routing modes

#### **Email Routing Logic**
1. **Self-Task** (`TO: remindme@astrid.cc`)
   - Creates task assigned to sender
   - Goes to sender's default list or inbox

2. **Assigned Task** (`CC: remindme@astrid.cc` + `TO: user@example.com`)
   - Creates task assigned to recipient
   - Sender becomes task creator

3. **Group Task** (`CC: remindme@astrid.cc` + multiple recipients)
   - Creates shared list with all recipients
   - Creates task visible to all

#### **Webhook Endpoint** ([app/api/webhooks/email/route.ts](../app/api/webhooks/email/route.ts))
- Supports multiple providers:
  - Cloudflare Email Workers
  - Resend inbound webhooks
  - Mailgun webhooks
- HTML-to-Markdown conversion (TurndownService)
- Attachment support
- Placeholder user creation for non-registered emails

## Cron Jobs & Scheduled Tasks

### **Vercel Cron Configuration** ([vercel.json](../vercel.json))

```json
"crons": [
  {
    "path": "/api/cron/reminders",
    "schedule": "* * * * *"  // Every minute
  }
]
```

### **Reminder Cron Job** ([app/api/cron/reminders/route.ts](../app/api/cron/reminders/route.ts))

#### **Executed Every Minute**
- Process due reminders (tasks with upcoming due dates)
- Retry failed reminder deliveries
- Send daily digests (top of every hour)
- Send weekly digests (top of every hour)

#### **Services Used**
- `ReminderService`: Core reminder logic ([lib/reminder-service.ts](../lib/reminder-service.ts))
- `EmailReminderService`: Send reminder emails
- `PushNotificationService`: Send push notifications

#### **Reminder Types**
1. **Immediate Reminders**: Tasks due now or past due
2. **Scheduled Reminders**: Custom reminder times
3. **Daily Digest**: Summary at user's preferred time (default 9 AM)
4. **Weekly Digest**: Sunday summary of upcoming week

#### **Queue Management** (`ReminderQueue` model)
- Status tracking: `pending`, `sent`, `failed`, `dismissed`, `snoozed`
- Retry logic for failed deliveries
- User-specific reminder settings (`ReminderSettings` model)

### **Manual Trigger** (Development Only)
```bash
POST /api/cron/reminders
{ "type": "due" | "daily" | "weekly" | "retry" | "all" }
```

## AI Agent System

### Coding Agent Workflow
1. **Task Assignment** → User assigns task to `astrid-code-assistant@astrid.cc`
2. **Plan Generation** → AI analyzes requirements and creates implementation plan
3. **User Approval** → User reviews plan via comment ("approve")
4. **Implementation** → AI creates GitHub branch, implements code, runs tests
5. **PR Creation** → AI creates pull request with preview deployment
6. **Review & Merge** → User reviews and merges via comment ("merge")

### **AI Orchestration Service** ([services/implementations/ai-orchestration.service.ts](../services/implementations/ai-orchestration.service.ts))
- Multi-provider support (Claude, OpenAI, Gemini)
- Automatic provider failover
- Cached API keys for performance
- Tool calling and function execution
- GitHub integration for code changes

### MCP (Model Context Protocol)

#### **Token-Based Access** ([app/api/mcp/operations/route.ts](../app/api/mcp/operations/route.ts))
- Secure API access for external AI tools (Claude Desktop, VS Code, etc.)
- CRUD Operations: 10+ operations for complete task management
- Permission Levels: Read, write, admin access controls
- Rate limiting: 100 requests per minute per token
- Testing Interface: Built-in testing page at `/settings/mcp-testing`

#### **MCP Operations**
1. `list_my_lists`: Get all accessible lists
2. `get_list_details`: Get list metadata and settings
3. `get_list_tasks`: Get tasks in a list
4. `get_task_details`: Get task with full details
5. `create_task`: Create new task
6. `update_task`: Update existing task
7. `delete_task`: Delete task
8. `add_comment`: Add comment to task
9. `get_task_comments`: Get all comments
10. `get_context`: Get user and workspace context

#### **Token Management**
- `MCPToken` model: User-specific access tokens
- Access levels: `READ`, `WRITE`, `ADMIN`
- Token expiration and revocation support
- API endpoints:
  - `GET /api/mcp/tokens`: List user's tokens
  - `POST /api/mcp/tokens`: Create new token
  - `DELETE /api/mcp/tokens/:id`: Revoke token

## Chat Messaging System

### Overview

Per-channel real-time messaging for list collaboration and personal AI assistant conversations. Each TaskList gets a shared channel; each user gets a virtual "My Tasks" channel.

### Architecture

```
ChatChannel (1:1 with TaskList or virtualKey)
  └── ChatMessage (text, markdown, or attachment)
        └── SecureFile[] (file attachments via Vercel Blob)
```

**API Routes:**
- `POST /api/chat/channels` — get-or-create channel ([app/api/chat/channels/route.ts](../app/api/chat/channels/route.ts))
- `GET /api/chat/channels/:id/messages` — paginated messages
- `POST /api/chat/channels/:id/messages` — send message (supports `fileId` for attachments)

**Client Hooks:**
- `useChatChannel` ([hooks/use-chat-channel.ts](../hooks/use-chat-channel.ts)) — message loading, sending, optimistic updates
- `useAgentTyping` ([hooks/use-agent-typing.ts](../hooks/use-agent-typing.ts)) — typing indicator state with 45s timeout safety

### Agent Response Rules

| Context | Auto-responds? | Trigger |
|---------|---------------|---------|
| My Tasks (virtual channel) | Yes | Every message |
| Private list (sole owner, no members) | Yes | Every message |
| Shared/public list | No | Only when @mentioned |
| Task comments | No | Only when @mentioned |

Logic: [app/api/chat/channels/[channelId]/messages/route.ts](../app/api/chat/channels/[channelId]/messages/route.ts) (line ~276)

### Astrid Agent Runtime ([lib/astrid-agent-runtime.ts](../lib/astrid-agent-runtime.ts))

When triggered (by @mention or auto-response), `processAstridMessage` provides the AI with:
- **Chat history** — last 20 messages with file contents for text-based attachments
- **Task context** — up to 15 uncompleted tasks with priorities and due dates
- **List defaults** — default assignee, priority from the list config
- **Reference IDs** — `@user`, `#list`, `!task` mentions include their database IDs
- **API access** — single `api_request` tool for full CRUD on tasks, comments, and lists

**Prompt injection protection:** file content is sanitized (strips system/instruction patterns) and wrapped in `<file>` tags marked as user data.

**Setup fallback:** if no API key is configured, Astrid posts a helpful message directing the user to `/settings/agents`.

### Typing Indicators

SSE events broadcast when an agent starts/stops processing:
- `agent_typing_start` — `{ channelId|taskId, agentId, agentName }`
- `agent_typing_stop` — `{ channelId|taskId, agentId }`

These are ephemeral (excluded from SSE replay cache). Client-side 45-second timeout auto-clears stale indicators. The `chat_message_created` or `comment_created` event from the agent also clears it.

### File Attachments on Messages

Upload flow: `POST /api/secure-upload/request-upload` with `{channelId}` context → returns `fileId` → send message with `fileId` and `type: "ATTACHMENT"`. The `SecureFile` record is linked to the `ChatMessage` via `chatMessageId`.

Viewing: `GET /api/secure-files/:fileId` redirects to a signed Vercel Blob URL (5-min expiry).

## Webhooks & External Integrations

### **GitHub Integration** ([lib/github-client.ts](../lib/github-client.ts))

#### **GitHub App**
- OAuth-based authentication
- Repository access for code generation
- Branch creation and PR management
- Webhook endpoint: `POST /api/github/webhooks`

#### **Webhook Events**
- `pull_request`: Track PR status, review comments
- `push`: Monitor branch updates
- `issue_comment`: Process user commands in PR comments

#### **AI Agent GitHub Workflow**
1. User assigns task to AI agent
2. AI creates implementation plan → posts as task comment
3. User approves plan → AI creates GitHub branch
4. AI implements code changes → pushes commits
5. AI creates pull request → Vercel creates preview deployment
6. User reviews PR → comments "approve" or "request changes"
7. AI merges PR → Task marked complete

### **AI Agent Webhooks**

#### **Claude Integration** ([app/api/webhooks/claude-integration/route.ts](../app/api/webhooks/claude-integration/route.ts))
- Webhook receiver for Claude API callbacks
- Tool result processing
- Conversation state management

#### **OpenAI Integration** ([app/api/webhooks/openai-integration/route.ts](../app/api/webhooks/openai-integration/route.ts))
- Webhook receiver for OpenAI Assistant API
- Function call results
- Run status updates

#### **Gemini Integration** ([app/api/webhooks/gemini-integration/route.ts](../app/api/webhooks/gemini-integration/route.ts))
- Webhook receiver for Gemini API
- Tool execution results

### **Generic AI Agent Webhook** ([app/api/webhooks/ai-agents/route.ts](../app/api/webhooks/ai-agents/route.ts))
- Unified webhook endpoint for all AI agents
- Provider-agnostic message format
- Event broadcasting to task subscribers

## Infrastructure & Deployment

### **Hosting & Platform**

#### **Vercel** (Primary Platform)
- Next.js 15.5 hosting with automatic deployments
- Edge Functions for API routes (30s timeout, 60s for migrations)
- Preview deployments for every PR
- Automatic HTTPS and global CDN
- Environment variable management
- Cron job support (1-minute granularity)

#### **Configuration** ([vercel.json](../vercel.json))
```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "functions": {
    "app/api/**/*.ts": { "maxDuration": 30 },
    "app/api/admin/migrate/route.ts": { "maxDuration": 60 }
  },
  "crons": [
    { "path": "/api/cron/reminders", "schedule": "* * * * *" }
  ]
}
```

### **Database & Storage**

#### **Neon (PostgreSQL)**
- Serverless PostgreSQL with automatic scaling
- Branching for preview environments
- Connection pooling via Prisma
- Database migrations via Prisma Migrate
- Point-in-time recovery

#### **Vercel Blob** (File Storage)
- Secure file uploads for task attachments
- Comment file attachments
- User avatars and list images
- Presigned URLs for secure access
- API: [app/api/secure-upload/request-upload/route.ts](../app/api/secure-upload/request-upload/route.ts)

#### **Upstash Redis**
- Serverless Redis for SSE state management
- REST API for serverless compatibility
- Used for pub/sub in multi-instance deployments
- Automatic connection management

### **Authentication & Security**

#### **NextAuth.js**
- OAuth providers: Google
- WebAuthn passkeys
- JWT-based sessions
- Secure cookie management
- Email change verification flow

#### **Apple Sign-In (iOS)**
- Custom endpoint at `/api/auth/apple`
- Verifies Apple identity tokens against Apple's JWKS
- Issues a session cookie directly (does not go through NextAuth)
- Password reset functionality

#### **Encryption**
- API keys encrypted with AES-256-CBC
- Environment-based encryption keys
- Secure token generation (nanoid)
- VAPID keys for push notifications

#### **Rate Limiting** ([lib/rate-limiter.ts](../lib/rate-limiter.ts))
- MCP operations: 100 requests/minute
- API endpoints: Configurable limits
- IP-based tracking
- User-based tracking for authenticated requests

### **Monitoring & Observability**

#### **Health Checks**
- `GET /api/health`: Basic health check
- `GET /api/sse/health`: SSE connection health
- `GET /api/sse/status`: SSE active connections count
- `GET /api/reminders/status`: Reminder system status

#### **Deployment Monitoring** ([scripts/monitor-vercel-deployments.ts](../scripts/monitor-vercel-deployments.ts))
- Automated deployment failure detection
- Creates tasks for failed deployments
- Error log analysis and auto-fix suggestions
- Integration with Astrid task system

#### **Logging**
- Server-side: Console logs with emojis for visibility
- Client-side: Development mode verbose logging
- SSE connection state tracking
- Offline sync operation logging

### **CI/CD Pipeline**

#### **GitHub Actions** (Potential)
- Type checking: `npm run typecheck`
- Linting: `npm run lint`
- Unit tests: `npm test`
- E2E tests: `npm run test:e2e`
- Build validation: `npm run build`

#### **Pre-deployment Checks** ([scripts/predeploy.sh](../scripts/predeploy.sh))
```bash
npm run predeploy        # TypeScript + ESLint + Vitest
npm run predeploy:full   # Includes Playwright E2E tests
npm run predeploy:quick  # TypeScript + ESLint only
```

#### **Deployment Workflow**
1. Developer pushes to feature branch
2. Vercel creates preview deployment
3. Automated tests run (optional GitHub Actions)
4. PR review and approval
5. Merge to `main` triggers production deployment
6. Deployment monitoring creates task if failures detected

### **Environment Management**

#### **Environment Variables**
- `.env.local`: Development secrets (not committed)
- `.env.production`: Production secrets (Vercel dashboard)
- Required variables:
  - `DATABASE_URL`: PostgreSQL connection string
  - `NEXTAUTH_SECRET`: Authentication secret
  - `RESEND_API_KEY`: Email service
  - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`: Redis
  - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`: Push notifications
  - `ENCRYPTION_KEY`: API key encryption
  - `CRON_SECRET`: Cron job authentication
  - AI Provider keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`

#### **Multi-Environment Support**
- Development: Local PostgreSQL, local Redis
- Preview: Neon branch database, Upstash Redis
- Production: Neon production database, Upstash Redis

### **Database Schema Management**

#### **Prisma Migrations**
- Schema: [prisma/schema.prisma](../prisma/schema.prisma)
- Migrations: `npx prisma migrate dev` (development)
- Migrations: `npx prisma migrate deploy` (production)
- Schema sync: `npx prisma db push` (development only)

#### **Key Models**
- `User`: Authentication and user settings
- `Task`: Task data with assignments and metadata
- `TaskList`: List organization and permissions
- `Comment`: Task comments with file attachments
- `MCPToken`: External API access tokens
- `ReminderQueue`: Scheduled reminder queue
- `PushSubscription`: Web push notification subscriptions
- `GitHubIntegration`: GitHub App installation data
- `AIAgent`: AI agent configurations

#### **Runtime Migrations** ([lib/runtime-migrations.ts](../lib/runtime-migrations.ts))
- On-demand schema updates for deployments
- API endpoint: `POST /api/admin/migrate`
- Used for production hotfixes without downtime

## Benefits of Current Architecture

### Development Benefits
- **Clear Separation**: Business logic separate from presentation
- **Testability**: Each layer can be tested independently
- **Maintainability**: Well-organized, modular codebase
- **Type Safety**: Full TypeScript coverage

### Performance Benefits
- **Optimized Rendering**: Proper memoization and state management
- **Real-time Updates**: Efficient SSE implementation with Redis pub/sub
- **Responsive Design**: Optimized for all device types
- **Multi-Layer Caching**: Browser cache, Redis, API key cache, IndexedDB
- **Offline-First**: Full functionality without internet connectivity
- **Progressive Enhancement**: PWA with service worker for offline support

### Feature Benefits
- **AI Integration**: Seamless automation and assistance with multi-provider support
- **Collaboration**: Real-time multi-user support via SSE broadcasts
- **Extensibility**: Plugin architecture via MCP for external tools
- **Reliability**: Comprehensive error handling, retry logic, and recovery
- **Email Integration**: Bidirectional email (inbound via `remindme@astrid.cc`, outbound via Resend)
- **Push Notifications**: Native browser notifications for reminders and digests
- **Scheduled Tasks**: Automated reminders and digest emails via Vercel Cron

### Scalability Benefits
- **Serverless Architecture**: Automatic scaling on Vercel
- **Connection Pooling**: Efficient database connections via Prisma
- **Redis Caching**: Fast state management for SSE and sessions
- **CDN Distribution**: Global edge network for static assets
- **Offline Sync**: Client-side queue prevents data loss during network issues

### Security Benefits
- **Encrypted API Keys**: AES-256-CBC encryption for sensitive credentials
- **Rate Limiting**: Protection against abuse and DDoS
- **JWT Sessions**: Secure authentication with NextAuth.js
- **CORS Protection**: Configured security headers
- **Access Control**: Role-based permissions (owner, admin, member)
- **Secure File Storage**: Presigned URLs for Vercel Blob uploads

## Architecture Diagrams

### **High-Level System Overview**

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Browser                           │
├─────────────────────────────────────────────────────────────────┤
│  React 19 UI  │  Service Worker  │  IndexedDB (Dexie)            │
│  (Next.js)    │  (Offline Cache) │  (Offline Storage)            │
└────────┬──────────────┬────────────────────┬─────────────────────┘
         │              │                    │
         │ HTTP/SSE     │ Background Sync    │ Offline Mutations
         │              │                    │
┌────────▼──────────────▼────────────────────▼─────────────────────┐
│                    Vercel Edge Network                            │
├─────────────────────────────────────────────────────────────────┤
│  API Routes (Next.js)  │  SSE Endpoint  │  Static Assets (CDN)  │
└────┬──────────┬────────────┬─────────────────────────────────────┘
     │          │            │
     │          │            └──────────┐
     │          │                       │
┌────▼──────────▼────────┐    ┌─────────▼──────────┐
│   Upstash Redis        │    │  Vercel Blob       │
│   (SSE State/Cache)    │    │  (File Storage)    │
└────────────────────────┘    └────────────────────┘
     │
┌────▼──────────────────────────────────────────────────┐
│           Neon PostgreSQL (Prisma ORM)                │
│   Users │ Tasks │ Lists │ Comments │ Reminders        │
└───────────────────────────────────────────────────────┘
```

### **Real-Time Update Flow**

```
User A (Browser)                  Vercel API                   User B (Browser)
      │                                │                              │
      │  POST /api/tasks (create)      │                              │
      ├───────────────────────────────>│                              │
      │                                │  Save to PostgreSQL           │
      │                                ├──────────────────>            │
      │                                │                              │
      │                                │  Publish to Redis             │
      │                                ├──────────────────>            │
      │                                │                              │
      │  201 Created (response)        │                              │
      │<───────────────────────────────┤                              │
      │                                │                              │
      │                                │  SSE: task_created            │
      │                                ├──────────────────────────────>│
      │                                │                              │
      │  SSE: task_created (via Redis) │                              │
      │<───────────────────────────────┤                              │
      │                                │                              │
      │  UI Updates                    │                   UI Updates │
      │                                │                              │
```

### **Offline Sync Flow**

```
User (Offline)              IndexedDB              Network              Server
      │                         │                      │                  │
      │  Create Task (offline)  │                      │                  │
      ├────────────────────────>│                      │                  │
      │                         │  Save with temp ID   │                  │
      │                         │  Queue mutation      │                  │
      │  UI Updates (optimistic)│                      │                  │
      │<────────────────────────┤                      │                  │
      │                         │                      │                  │
      │         ...network reconnects...                                 │
      │                         │                      │                  │
      │                         │  Sync pending mutations                 │
      │                         ├─────────────────────>│  POST /api/tasks │
      │                         │                      ├─────────────────>│
      │                         │                      │                  │
      │                         │                      │  { id: "real-id" }│
      │                         │                      │<─────────────────┤
      │                         │  Save ID mapping     │                  │
      │                         │  (temp-id → real-id) │                  │
      │                         │<─────────────────────┤                  │
      │                         │  Remove temp entity  │                  │
      │  UI Updates (real IDs)  │                      │                  │
      │<────────────────────────┤                      │                  │
```

## Summary

This architecture provides a **production-ready, scalable, and maintainable** foundation for the Astrid task management application with:

- ✅ **Offline-first** capabilities with IndexedDB and service workers
- ✅ **Real-time collaboration** via Server-Sent Events and Redis pub/sub
- ✅ **Multi-layer caching** for optimal performance
- ✅ **AI integration** with Claude, OpenAI, and Gemini
- ✅ **Email integration** (bidirectional) for task creation and notifications
- ✅ **Push notifications** for reminders and digests
- ✅ **Automated background jobs** via Vercel Cron
- ✅ **Comprehensive testing** with Vitest and Playwright
- ✅ **Type-safe** development with TypeScript and Prisma
- ✅ **Security-first** design with encryption, rate limiting, and access control
- ✅ **Developer experience** with clean separation of concerns and excellent tooling

For detailed implementation guides, see the [documentation index](./README.md).