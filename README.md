# Astrid Task Manager

A modern, production-ready task management application built with Next.js, NextAuth.js, and Prisma.

## Features

- **Real Authentication**: Google OAuth + WebAuthn passkeys with NextAuth.js (JWT sessions); Apple Sign-In on iOS
- **Database Integration**: PostgreSQL/SQLite with Prisma ORM
- **Task Management**: Create, edit, delete, and organize tasks
- **List Organization**: Group tasks into customizable lists
- **User Collaboration**: Share lists and tasks with other users
- **Modern UI**: Built with Shadcn/ui components and Tailwind CSS

## Tech Stack

- **Frontend**: Next.js 15.5, React 19, TypeScript 5
- **Authentication**: NextAuth.js with Google OAuth + Credentials
- **Database**: Prisma with PostgreSQL (Neon serverless)
- **Styling**: Tailwind CSS + Shadcn/ui components (Radix UI)
- **Testing**: Vitest (unit/integration) + Playwright (E2E)
- **Email**: Resend + Cloudflare Email Routing
- **AI Integration**: Claude/OpenAI/Gemini with MCP support
- **Deployment**: Vercel with automated migrations

## Getting Started

### Quick Start (Recommended)

One command installs everything you need (Homebrew, PostgreSQL, Node.js, npm packages, database):

```bash
git clone https://github.com/Graceful-Tools/astrid-web.git
cd astrid-web
./scripts/setup.sh
```

Then start the dev server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the demo account: `demo@astrid.cc`

> **Note:** The setup script creates `.env.local` from `.env.example`. To enable Google OAuth sign-in, add your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env.local`. See `.env.example` for all available options.

---

### Manual Setup

If you prefer to set things up yourself, or are not on macOS:

#### 1. Install PostgreSQL

The app requires PostgreSQL. Choose one option:

**Option A: Homebrew (macOS)**
```bash
brew install postgresql@17
brew services start postgresql@17
```

Then add it to your PATH so `psql`, `createdb`, etc. are available:
```bash
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```
> **Important:** PostgreSQL 17 is keg-only in Homebrew, so this PATH step is required.

Create the development database:
```bash
createdb astrid_dev
```

Your `DATABASE_URL` will be:
```
postgresql://$(whoami)@localhost:5432/astrid_dev
```

**Option B: [Postgres.app](https://postgresapp.com/) (macOS)**

1. Download and install from [postgresapp.com](https://postgresapp.com/)
2. Open Postgres.app and click "Initialize" to start the server
3. Add CLI tools to your PATH:
   ```bash
   sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
   ```
4. Create the database:
   ```bash
   createdb astrid_dev
   ```

**Option C: Docker**
```bash
docker run --name astrid-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=astrid_dev -p 5432:5432 -d postgres:17
```

Your `DATABASE_URL` will be:
```
postgresql://postgres:password@localhost:5432/astrid_dev
```

**Option D: [Neon](https://neon.tech/) (Cloud - no local install)**

1. Create a free project at [neon.tech](https://neon.tech/)
2. Copy the connection string from the dashboard
3. Use the pooled URL as `DATABASE_URL` and the direct URL as `DATABASE_URL_DIRECT`

**Verify PostgreSQL is running:**
```bash
pg_isready
# Should output: localhost:5432 - accepting connections
```

#### 2. Clone and install

```bash
git clone https://github.com/Graceful-Tools/astrid-web.git
cd astrid-web
npm install
```

#### 3. Set up environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in your values. At minimum:
```env
DATABASE_URL="postgresql://youruser@localhost:5432/astrid_dev"
DATABASE_URL_DIRECT="postgresql://youruser@localhost:5432/astrid_dev"
NEXTAUTH_SECRET="$(openssl rand -base64 32)"
NEXTAUTH_URL="http://localhost:3000"
```

See `.env.example` for all available options (Google OAuth, email, AI features, etc.)

#### 4. Set up the database

```bash
npm run db:generate
npm run db:push
npm run db:seed
```

#### 5. Set up Redis (optional, for caching)

```bash
brew install redis        # macOS
brew services start redis
```

#### 6. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Authentication

The application uses NextAuth.js with JWT sessions for authentication:

**Test the authentication system:**
```bash
./scripts/check-auth.sh
```

**Important:** The system uses JWT sessions (not database sessions). See [`docs/AUTHENTICATION.md`](./docs/AUTHENTICATION.md) for details.

## Database Setup

The application uses Prisma for database management. You can:

- **Generate Prisma client**: `npm run db:generate`
- **Push schema changes**: `npm run db:push`
- **Open Prisma Studio**: `npm run db:studio`
- **Reset database**: `npm run db:reset`

## Redis Caching

The application uses Redis for caching to improve performance. Redis is optional but recommended.

### Testing Redis Locally

**1. Check Redis is running:**
```bash
redis-cli ping  # Should return "PONG"
```

**2. Monitor cache activity:**
```bash
redis-cli monitor
```
Then use your app - you'll see cache operations like:
```
"SETEX" "tasks:user:123" "120" "{...task data...}"
"GET" "tasks:user:123"
```

**3. Check cached data:**
```bash
redis-cli keys "*"                    # Show all cache keys
redis-cli get "tasks:user:userid"     # View cached task data
redis-cli flushall                    # Clear all cache (for testing)
```

**4. Look for cache logs:**
- Browser console shows "✅ Cache hit" vs "❌ Cache miss" messages
- Load a page with tasks, then refresh immediately (should be faster on second load)

### Cache Behavior
- **User tasks**: 2-minute TTL
- **User lists**: 5-minute TTL  
- **Task comments**: 5-minute TTL
- **Automatic invalidation**: When data is created/updated/deleted

## Deployment

The application uses **GitHub Actions** to deploy to Vercel, not Vercel's automatic Git integration. This approach prevents permission issues and gives better control over deployments.

### Quick Start

**Deployments are triggered automatically:**
- Push to `main` → Production deployment
- Push to `staging` → Staging deployment
- Open/update PR → Preview deployment

**Manual deployment:**
Go to Actions → Select workflow → Run workflow

### Setup Requirements

1. Set up your production database
2. Configure environment variables in Vercel
3. Add required GitHub secrets (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, etc.)
4. **Disable Vercel's Git integration** in project settings

**📚 Full deployment guide:** [docs/deployment/VERCEL_GITHUB_ACTIONS.md](./docs/deployment/VERCEL_GITHUB_ACTIONS.md)

This guide covers:
- Why we use GitHub Actions instead of Vercel Git integration
- Step-by-step setup instructions
- Troubleshooting common issues
- Rollback procedures

## Reminder System Testing & Debugging

Astrid includes a comprehensive reminder system with multiple layers (database, Service Worker, PWA notifications). Use the debug interface to test and troubleshoot reminders.

### Debug Interface

Navigate to `/debug-reminders` when running the development server:
```
http://localhost:3000/debug-reminders
```

### Quick Testing Steps

**1. Enable Notifications**
- Allow notifications when prompted by your browser
- Required for PWA and Service Worker testing

**2. Select Test User**
- Enter any user's email address
- Click **"Load User's Reminders"** to view their existing reminders

**3. Test Immediate Notifications**
- Click **"Test Push Notification"** for instant notification test
- Click **"Test Service Worker"** for 30-second delayed notification

**4. Create Test Tasks with Reminders**
- Set task title and minutes until due (1-2 minutes recommended)
- Click **"Create Test Task"** - automatically creates reminders
- Watch console for scheduling logs:
  ```
  🧪 Debug: Creating task for test user user@example.com
  📅 Added automatic due_reminder to queue for task...
  Service Worker: Scheduled client-side reminder...
  ```

**5. Test Reminder Actions**
- When notification appears, test action buttons:
  - **"View Task"** - opens app to specific task
  - **"Snooze 15min"** - reschedules reminder
  - **"Mark Complete"** - completes the task

### PWA Testing (Advanced)

**Test notifications when app is closed:**
1. Install app as PWA (Add to Home Screen)
2. Create task due in 2-3 minutes
3. **Close PWA completely** (don't minimize)
4. Wait for notification - should appear even when closed
5. Tap notification - should reopen app to specific task

### Console Logs to Monitor

**Successful scheduling:**
```javascript
✅ Service Worker registered successfully
📅 Added automatic due_reminder to queue for task abc123
Service Worker: Scheduled client-side reminder for task abc123
🔔 Triggered due_reminder for task abc123
Service Worker: Showed client-side reminder for task abc123
```

### Database Verification

Check the `ReminderQueue` table for scheduled reminders:
```sql
SELECT 
  r.id,
  r.type,
  r."scheduledFor",
  r.status,
  r.data->>'taskTitle' as title,
  t.title as actual_title
FROM "ReminderQueue" r
JOIN "Task" t ON r."taskId" = t.id
WHERE r.status = 'pending'
ORDER BY r."scheduledFor";
```

### Troubleshooting

**Notifications not appearing:**
- Check browser notification permissions
- Verify Service Worker is active (DevTools → Application → Service Workers)
- Look for console errors

**Service Worker issues:**
- Hard refresh (Ctrl+Shift+R) to reload Service Worker
- Check HTTPS requirement (or use localhost)

**Database reminders not created:**
- Verify `DATABASE_URL` environment variable
- Run `npx prisma migrate dev` if needed
- Check for scheduling logs in console

### Testing Files

- **Debug Interface**: `/app/debug-reminders/page.tsx`
- **Service Worker**: `/public/sw.js`

## Documentation

📚 **Complete documentation is available in the [`/docs`](./docs/README.md) directory:**

### Quick Links
- **[Documentation Index](./docs/README.md)** - Complete guide to all documentation
- **[Architecture Overview](./docs/ARCHITECTURE.md)** - System design and architecture
- **[Setup Guides](./docs/setup/)** - Database, auth, email, and deployment setup
- **[AI Agents](./docs/ai-agents/README.md)** - AI coding agent setup and usage
- **[MCP Testing](./docs/testing/MCP_TESTING_GUIDE.md)** - Model Context Protocol testing
- **[Development Guidelines](./docs/guides/development-guidelines.md)** - Code quality standards

### Key Features Documentation
- **[Quick Reference](./docs/context/quick-reference.md)** - Essential commands and patterns
- **[API Contracts](./docs/context/api_contracts.md)** - Endpoint specifications
- **[Testing Strategy](./docs/context/testing.md)** - Testing setup and patterns

## Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

**Key resources:**
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - Community standards
- [SECURITY.md](SECURITY.md) - Security vulnerability reporting
- [docs/API_CONTRACT.md](docs/API_CONTRACT.md) - API stability contract

**Quality checks before submitting:**
```bash
npm run predeploy:quick  # TypeScript + lint
npm run predeploy        # Full test suite
```

## Related Projects

- **iOS App**: [astrid-ios](https://github.com/Graceful-Tools/astrid-ios) - Native iOS client
- **SDK**: [@gracefultools/astrid-sdk](https://www.npmjs.com/package/@gracefultools/astrid-sdk) - AI agent SDK

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Public Lists System

The application features a comprehensive public lists system that allows users to share and copy lists with complete task collections.

### How Public Lists Work

**Public Lists vs Shared Lists:**
- **Shared Lists**: Traditional collaboration where multiple users edit the same list
- **Public Lists**: Template lists that users can copy entirely to their own account, including all tasks and settings

**Key Features:**
- **Publishing**: Users can mark their lists as "public" to share them as templates
- **Copying**: Any user can copy a public list, including all tasks, settings, and metadata
- **Discovery**: Browse popular public lists ranked by copy count
- **Search**: Find specific public lists by name, description, or content

### Publishing a List

To make a list public:
1. Open list settings (gear icon)
2. Set Privacy to "PUBLIC"
3. The list becomes available for others to copy

### Copying Public Lists

For public lists, users see a "Copy to My Lists" action instead of edit controls:
- **Copy List**: Creates a new list with identical settings
- **Copy Tasks**: Includes all tasks from the original list
- **Ownership**: User becomes owner of the copied list and can modify freely
- **Independence**: Changes to copied list don't affect the original

### Public Lists Browser

**Popular Lists Section:**
- Appears below "My Lists" in the sidebar
- Shows most popular public lists (by copy count)
- Quick access to frequently copied lists

**Full Browser Modal:**
- Search functionality for finding specific lists
- Preview mode showing:
  - List description and settings
  - Task count and sample tasks
  - Copy count (popularity indicator)
  - List creator information
- Detailed view before copying

### API Endpoints

**Copy Operations:**
```bash
POST /api/lists/[id]/copy          # Copy list with all tasks
POST /api/tasks/[id]/copy          # Copy individual task
```

**Public Lists Discovery:**
```bash
GET /api/lists/public              # Get popular public lists
GET /api/lists/public/search       # Search public lists
GET /api/lists/[id]/preview        # Preview public list details
```

### Database Schema

**Copy Tracking:**
- `copyCount` field tracks how many times a list has been copied
- `copiedFromId` field links copied lists to their source
- `originalCreatorId` preserves attribution information

**Privacy Levels:**
- `PRIVATE`: Only owner and shared members can access
- `PUBLIC`: Anyone can view and copy the list
- Public lists cannot be directly edited by non-members

### Use Cases

**Template Lists:**
- Project templates with predefined tasks
- Onboarding checklists for teams
- Educational curricula with assignments
- Event planning templates

**Knowledge Sharing:**
- Best practices in task organization
- Industry-specific workflows
- Personal productivity systems
- Community-created resources

## Default Lists

The system provides three default virtual lists for new users:

**Today:**
- Default Assignee: Task Creator
- Default Due Date: Today
- Show tasks: incomplete only
- Due date filter: due before tomorrow
- Favorite: 1

**Not in a List:**
- Default Assignee: current user
- Default Due Date: no default
- Assignee filter: current user
- Show tasks: incomplete only
- Due date filter: all
- Favorite: 2

**I've Assigned:**
- Default Assignee: unassigned
- Default Due Date: no default
- Show tasks: incomplete only
- Due date filter: all
- Favorite: 3
