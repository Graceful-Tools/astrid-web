# MVC Architecture for AI Agent Webhooks

## Overview

The AI agent webhook system has been refactored to follow a proper Model-View-Controller (MVC) architecture with dependency injection. This makes the core business logic platform-agnostic and reusable across web, mobile, and other platforms.

## Architecture Layers

### 1. **Controller Layer** (`/controllers/`)
- **Purpose**: Pure business logic, platform-agnostic
- **Responsibilities**:
  - Orchestrate business workflows
  - Validate business rules
  - Coordinate between repositories and services
- **Example**: `AIAgentWebhookController`

### 2. **Repository Layer** (`/repositories/`)
- **Purpose**: Data access abstraction
- **Pattern**: Interface + Implementation
- **Responsibilities**:
  - CRUD operations
  - Query complex data relationships
  - Abstract database specifics

#### Interfaces (`/repositories/interfaces/`)
- `ITaskRepository` - Task data operations
- `IUserRepository` - User data operations
- `ICommentRepository` - Comment data operations
- `IAIAgentRepository` - AI Agent data operations

#### Implementations (`/repositories/implementations/`)
- `PrismaTaskRepository` - Prisma-based task operations
- `PrismaUserRepository` - Prisma-based user operations
- `PrismaCommentRepository` - Prisma-based comment operations

### 3. **Service Layer** (`/services/`)
- **Purpose**: Cross-cutting concerns and external integrations
- **Responsibilities**:
  - Notifications (SSE, push)
  - AI orchestration
  - External API calls
  - Complex business processes

#### Interfaces (`/services/interfaces/`)
- `INotificationService` - Notification abstraction
- `IAIOrchestrationService` - AI processing abstraction

#### Implementations (`/services/implementations/`)
- `NotificationService` - SSE + push notifications
- `AIOrchestrationService` - AI workflow management

### 4. **View Layer** (`/app/api/*/route.ts`)
- **Purpose**: HTTP request/response handling
- **Responsibilities**:
  - Parse HTTP requests
  - Validate input format
  - Apply rate limiting
  - Return HTTP responses
  - Handle HTTP-specific concerns

### 5. **Dependency Injection** (`/lib/dependency-container.ts`)
- **Purpose**: Manage dependencies and enable testing
- **Benefits**:
  - Easy to swap implementations
  - Testable (mock dependencies)
  - Centralized configuration
  - Platform-agnostic setup

## Benefits for Multi-Platform Development

### 1. **Platform Portability**
```typescript
// The same controller can be used in:

// Web (Next.js)
const container = DependencyContainer.getInstance()
const controller = container.getAIAgentWebhookController()
const result = await controller.handleWebhook(payload)

// Mobile (React Native)
const container = new MobileDependencyContainer() // Different DI setup
const controller = container.getAIAgentWebhookController() // Same controller!
const result = await controller.handleWebhook(payload)

// Desktop (Electron)
const container = new DesktopDependencyContainer() // Different DI setup
const controller = container.getAIAgentWebhookController() // Same controller!
const result = await controller.handleWebhook(payload)
```

### 2. **Database Flexibility**
```typescript
// For web: Use Prisma
const container = new DependencyContainer()
container.setTaskRepository(new PrismaTaskRepository(prisma))

// For mobile: Use SQLite
const container = new MobileDependencyContainer()
container.setTaskRepository(new SQLiteTaskRepository(sqliteDb))

// For offline: Use local storage
const container = new OfflineDependencyContainer()
container.setTaskRepository(new LocalStorageTaskRepository())
```

### 3. **Testing Benefits**
```typescript
// Easy to test with mocks
const mockTaskRepo = new MockTaskRepository()
const mockNotificationService = new MockNotificationService()

const controller = new AIAgentWebhookController(
  mockTaskRepo,
  mockAIAgentRepo,
  mockUserRepo,
  mockCommentRepo,
  mockNotificationService,
  mockAIOrchestrationService
)

// Test business logic without database dependencies
const result = await controller.handleWebhook(testPayload)
expect(result.success).toBe(true)
```

## Migration Benefits

### **Before (Monolithic Route)**
```typescript
// route.ts - Everything mixed together
export async function POST(request) {
  const prisma = new PrismaClient() // Tight coupling

  // HTTP concerns mixed with business logic
  const body = await request.json()

  // Database access mixed with validation
  const task = await prisma.task.findFirst(...)

  // Business logic scattered throughout
  if (!task) return NextResponse.json(...)

  // Direct Prisma calls everywhere
  await prisma.comment.create(...)

  // Hard to test, hard to reuse
}
```

### **After (MVC Pattern)**
```typescript
// route.ts - Pure HTTP handling
export async function POST(request) {
  const container = DependencyContainer.getInstance()
  const controller = container.getAIAgentWebhookController()

  const payload = TaskAssignmentSchema.parse(await request.json())
  const result = await controller.handleWebhook(payload)

  return NextResponse.json(result)
}

// controller.ts - Pure business logic
class AIAgentWebhookController {
  async handleWebhook(payload) {
    const task = await this.taskRepository.findByIdWithRelations(...)
    if (!task) return { success: false, error: 'TASK_NOT_FOUND' }

    // Clean business logic
    return await this.handleTaskAssignment(payload, task)
  }
}
```

## Database Connection Stability

### **Problem Solved**
The original architecture created multiple Prisma instances, causing connection conflicts:

```typescript
// OLD: Multiple instances
const prisma = new PrismaClient() // In route
const prisma2 = new PrismaClient() // In service
const prisma3 = new PrismaClient() // In helper function
```

### **Solution: Single Instance Management**
```typescript
// NEW: Centralized instance
class DependencyContainer {
  private prisma: PrismaClient

  constructor() {
    this.prisma = new PrismaClient() // Single instance
  }

  // All repositories share the same instance
  getTaskRepository() {
    return new PrismaTaskRepository(this.prisma)
  }
}
```

## Platform-Specific Implementations

### **Web Platform** (Current)
```typescript
// web-container.ts
export class WebDependencyContainer extends DependencyContainer {
  constructor() {
    super()
    // Web-specific services
    this.notificationService = new SSENotificationService()
    this.aiOrchestrationService = new WebAIOrchestrationService()
  }
}
```

### **Mobile Platform** (Future)
```typescript
// mobile-container.ts
export class MobileDependencyContainer {
  constructor() {
    // Mobile-specific implementations
    this.taskRepository = new SQLiteTaskRepository()
    this.notificationService = new PushNotificationService()
    this.aiOrchestrationService = new MobileAIOrchestrationService()
  }

  getAIAgentWebhookController() {
    // Same controller interface, different implementations
    return new AIAgentWebhookController(
      this.taskRepository,
      this.aiAgentRepository,
      this.userRepository,
      this.commentRepository,
      this.notificationService,
      this.aiOrchestrationService
    )
  }
}
```

### **Offline Platform** (Future)
```typescript
// offline-container.ts
export class OfflineDependencyContainer {
  constructor() {
    // Offline-first implementations
    this.taskRepository = new IndexedDBTaskRepository()
    this.notificationService = new LocalNotificationService()
    this.aiOrchestrationService = new QueuedAIOrchestrationService()
  }
}
```

## Usage Examples

### **Current Web Usage**
```typescript
// In Next.js API route
const container = DependencyContainer.getInstance()
const controller = container.getAIAgentWebhookController()
const result = await controller.handleWebhook(payload)
```

### **Future Mobile Usage**
```typescript
// In React Native
import { MobileDependencyContainer } from './mobile-container'

const container = new MobileDependencyContainer()
const controller = container.getAIAgentWebhookController()

// Same controller interface!
const result = await controller.handleWebhook(payload)
```

### **Testing Usage**
```typescript
// In Jest tests
const container = new TestDependencyContainer()
container.setTaskRepository(new MockTaskRepository())
container.setNotificationService(new MockNotificationService())

const controller = container.getAIAgentWebhookController()
const result = await controller.handleWebhook(testPayload)

expect(result.success).toBe(true)
```

## Summary

This MVC architecture provides:

1. **🔄 Reusable Logic**: Core business logic works across platforms
2. **🧪 Testability**: Easy to mock dependencies and test in isolation
3. **🔧 Maintainability**: Clear separation of concerns
4. **🚀 Scalability**: Easy to add new features and platforms
5. **💾 Stability**: Single database connection management
6. **🎯 Flexibility**: Swap implementations without changing business logic

The controller becomes the "brain" that can be plugged into any platform with the right repository and service implementations.