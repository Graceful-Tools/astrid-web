# Quick Reference

## Essential Commands

### Development
```bash
npm run dev          # Start development server
npm run build        # Build with migrations
npm run test         # Run tests in watch mode
npm run test:run     # Run tests once
npm run test:ui      # Run tests with UI
npm run lint         # Run ESLint
```

### Database
```bash
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema to database
npm run db:migrate   # Run migrations
npm run db:studio    # Open Prisma Studio
npm run db:seed      # Seed database
```

## Key Dependencies

### Core
- **Next.js**: 15.5.0 (App Router)
- **React**: 19.0.0
- **TypeScript**: 5
- **Prisma**: 6.14.0
- **NextAuth**: Latest
- **Playwright**: 1.56.0 (E2E testing)

### UI & Styling
- **Tailwind CSS**: 3.4.17
- **Radix UI**: Component primitives
- **Lucide React**: Icons
- **React Hook Form**: Form handling
- **Zod**: Validation

### Testing
- **Vitest**: 3.2.4
- **React Testing Library**: Component testing
- **jsdom**: DOM environment

## Database Schema

### Core Models
```typescript
User {
  id, email, name, image, isActive, emailVerified
  accounts[], sessions[], ownedLists[], assignedTasks[]
}

TaskList {
  id, name, description, color, privacy, ownerId
  owner, admins[], members[], tasks[]
}

Task {
  id, title, description, priority, repeating, isPrivate
  assigneeId, creatorId, when, lists[]
}

Comment {
  id, content, type, authorId, taskId, parentCommentId
  author, task, replies[]
}
```

### Key Relationships
- User owns TaskLists (one-to-many)
- User can be admin/member of TaskLists (many-to-many)
- Tasks belong to TaskLists (many-to-many)
- Tasks have assignee and creator (many-to-one)
- Comments belong to Tasks (many-to-one)
- Comments can have replies (self-referencing)

## API Patterns

### Authentication Check
```typescript
const session = await getServerSession(authConfig)
if (!session?.user?.id) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}
```

### Error Response
```typescript
return NextResponse.json({ error: "Error message" }, { status: 400 })
```

### Success Response
```typescript
return NextResponse.json(data)
```

## Common Prisma Queries

### Find User with Relations
```typescript
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    ownedLists: true,
    memberLists: true,
    assignedTasks: true
  }
})
```

### Find Lists with Access Control
```typescript
const lists = await prisma.taskList.findMany({
  where: {
    OR: [
      { ownerId: userId },
      { admins: { some: { id: userId } } },
      { members: { some: { id: userId } } },
      { privacy: "PUBLIC" }
    ]
  }
})
```

### Create with Relations
```typescript
const task = await prisma.task.create({
  data: {
    title: "Task title",
    assigneeId: userId,
    creatorId: userId,
    lists: { connect: listIds.map(id => ({ id })) }
  },
  include: {
    assignee: true,
    creator: true,
    lists: true
  }
})
```

## Environment Variables

### Required
```bash
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=your-secret
NEXTAUTH_URL=http://localhost:3000
```

### OAuth & External Services
```bash
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### Email Services
```bash
RESEND_API_KEY=your-resend-key
FROM_EMAIL=noreply@yourdomain.com
```

### AI Services (Optional)
```bash
ANTHROPIC_API_KEY=your-claude-api-key
OPENAI_API_KEY=your-openai-key
GOOGLE_AI_API_KEY=your-gemini-key
```
GitHub Copilot is supported through GitHub's official Copilot SDK. Users connect
their GitHub account with OAuth; tokens are encrypted server-side and are not
pasted into the AI-key manager.

### Storage & Caching
```bash
UPSTASH_REDIS_REST_URL=your-upstash-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-token
BLOB_READ_WRITE_TOKEN=your-vercel-blob-token
```

### Push Notifications
```bash
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:noreply@yourdomain.com
```

### Security & Encryption
```bash
ENCRYPTION_KEY=your-32-byte-hex-string
CRON_SECRET=your-cron-secret
```

### Inbound Email Webhook
```bash
CLOUDFLARE_EMAIL_WEBHOOK_SECRET=shared-secret
```
Shared secret for the Cloudflare inbound-email webhook; verified against the `x-astrid-webhook-secret` request header. Must be set in Vercel Production.

## File Structure

### Key Directories
```
app/api/           # API routes
app/auth/          # Auth pages
components/ui/     # Reusable UI components
components/auth/   # Auth components
lib/               # Utilities and config
types/             # TypeScript types
tests/             # Test files
prisma/            # Database schema and migrations
```

### Important Files
- `lib/prisma.ts` - Database client
- `lib/auth-config.ts` - NextAuth configuration
- `lib/database-utils.ts` - Database utilities
- `types/index.ts` - Main type exports
- `tests/setup.ts` - Test configuration

## Testing Patterns

### Component Test Setup
```typescript
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

// Mock dependencies
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: mockUser }, status: 'authenticated' })
}))

// Test component
render(<Component />)
expect(screen.getByText('Expected text')).toBeInTheDocument()
```

### API Route Test
```typescript
import { NextRequest } from 'next/server'
import { GET } from './route'

// Mock session
vi.mocked(getServerSession).mockResolvedValue(mockSession)

// Test endpoint
const response = await GET()
expect(response.status).toBe(200)
```

## Performance Tips

### Database
- Use strategic indexes (already configured in schema)
- Eager load related data with `include`
- Implement pagination for large datasets
- Use composite indexes for common query patterns

### Frontend
- Use Next.js Image component for optimization
- Implement proper loading states
- Use React.memo for expensive components
- Lazy load non-critical components

## UI Component Patterns

### Empty State Component
**AstridEmptyState** - Reminders-style empty state with contextual messaging

```typescript
import { AstridEmptyState } from '@/components/ui/astrid-empty-state'

<AstridEmptyState
  listType="personal"  // or: shared, today, my-tasks, public, etc.
  listName="My List"
  isViewingFromFeatured={false}
/>
```

**List Type Messages:**
- `personal` → "Ready to capture your thoughts?"
- `shared` → "Start collaborating!"
- `today` → "Nothing scheduled for today!"
- `my-tasks` → "You're all caught up!"
- `public` → "Share your ideas with the world!"
- Featured lists → "This list is empty right now!"

**Features:**
- Astrid character with gradient styling
- Speech bubble UI with contextual prompts
- Theme-aware (light/dark mode)
- Subtle animations (fade-in, slide-in)
- Mobile hint arrow for task creation
- Responsive design

## Common Issues & Solutions

### Prisma Client Generation
```bash
# If schema changes, regenerate client
npm run db:generate
```

### Database Connection
```bash
# Test database connection
npm run db:test
```

### Type Errors
```bash
# Check TypeScript compilation
npm run predeploy:quick
```

### Build Issues
```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```
