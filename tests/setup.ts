import '@testing-library/jest-dom'
import { vi } from 'vitest'
import 'fake-indexeddb/auto'
import rawEnMessages from '@/lib/i18n/locales/en.json'
import { applyBrandToMessages } from '@/lib/brand/i18n-values'

// Mirror lib/i18n/request.ts: copy stores `{appName}` and the brand is substituted at
// load time, so tests asserting on rendered copy see the same strings the app renders.
const enMessages = applyBrandToMessages(rawEnMessages)

// Mock NextAuth
global.jest = {
  mock: (module: string, factory?: () => any) => {
    // Mock implementation for jest.mock in vitest
  }
} as any

// Mock environment variables - use existing env vars or fallback to test defaults
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret'
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000'
// process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test_db' // Mocked by vi.mock('@/lib/prisma')
// 32-byte hex key for AES-256 encryption (used by field-encryption.ts and ai-api-keys)
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

// Mock window.matchMedia and localStorage (only in browser-like environments)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })

  // Mock localStorage
  const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: vi.fn(() => {
        store = {}
      }),
      get length() {
        return Object.keys(store).length
      },
      key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    }
  })()

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
  })

  // Also define on globalThis for consistency
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
  })
}

// Mock prisma client for tests
export const mockPrisma = {
  user: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
  },
  task: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  taskList: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
  },
  listMember: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
  },
  userListFavorite: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  listInvite: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  comment: {
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  },
  reminderQueue: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  secureFile: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
  },
  chatChannel: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
  },
  chatMessage: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  },
  oAuthClient: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  oAuthToken: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  oAuthAuthorizationCode: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  mCPToken: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  codingTaskWorkflow: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
  },
  userWebhookConfig: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  deletionLog: {
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  copilotCredential: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  gitHubIntegration: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  session: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
}

// Mock next-auth with proper mocks
const mockGetServerSession = vi.fn(() => Promise.resolve({
  user: {
    id: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    image: 'test-image-url',
  }
}))

vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: mockGetServerSession,
}))

vi.mock('next-auth/next', () => ({
  getServerSession: mockGetServerSession,
}))

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(() => ({
    data: {
      user: {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        image: 'test-image-url',
      }
    },
    status: 'authenticated'
  })),
  getSession: vi.fn(async () => ({
    user: {
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: 'test-image-url',
    }
  })),
  signIn: vi.fn(),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock OpenAI client
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    images: {
      generate: vi.fn().mockResolvedValue({
        data: [{ url: 'https://example.com/generated-image.png' }]
      })
    }
  }))
}))

// Mock OpenAI module
vi.mock('@/lib/openai', () => ({
  generateListImage: vi.fn().mockResolvedValue('https://example.com/generated-image.png'),
  validateOpenAIConfig: vi.fn().mockReturnValue(false), // Disable OpenAI in tests to avoid complications
  getAvailableImageStyles: vi.fn().mockReturnValue([]),
  getAvailableThemes: vi.fn().mockReturnValue([])
}))

// Mock SSE Manager and related hooks globally
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    subscribe: vi.fn(() => vi.fn()), // Returns unsubscribe function
    onConnectionChange: vi.fn(() => vi.fn()),
    getConnectionStatus: vi.fn(() => ({
      isConnected: true,
      isConnecting: false,
      connectionAttempts: 0,
      subscriptionCount: 1,
      lastEventTime: Date.now()
    })),
    getDebugInfo: vi.fn(() => ({
      connectionStatus: {
        isConnected: true,
        isConnecting: false,
        connectionAttempts: 0,
        subscriptionCount: 1,
        lastEventTime: Date.now()
      },
      subscriptions: [],
      subscriptionsByComponent: {}
    })),
    forceReconnect: vi.fn()
  }
}))

vi.mock('@/hooks/use-sse-subscription', () => ({
  useSSESubscription: vi.fn(() => ({
    isConnected: true
  })),
  useSSEConnectionStatus: vi.fn(() => ({
    isConnected: true,
    connectionAttempts: 0,
    lastEventTime: Date.now(),
    subscriptionCount: 1
  })),
  useTaskSSEEvents: vi.fn(() => ({
    isConnected: true
  })),
  useCodingWorkflowSSEEvents: vi.fn(() => ({
    isConnected: true
  }))
}))

// Export the mock for use in tests
export { mockGetServerSession }

// Mock Prisma client
vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

// Mock i18n translations
vi.mock('@/lib/i18n/client', () => ({
  useTranslations: vi.fn(() => ({
    t: (key: string, params?: Record<string, string>) => {
      // Return the English translations for testing
      const translations: Record<string, string> = {
        'search.placeholder': 'Search for tasks and users',
        'search.noResults': 'No results found',
        'search.searching': 'Searching...',
        'listHeaders.myTasks': 'My Tasks',
        'listHeaders.myTasksDescription': 'All your tasks',
        'listHeaders.today': 'Today',
        'listHeaders.todayDescription': 'Tasks due today',
        'listHeaders.assigned': 'Assigned',
        'listHeaders.assignedDescription': 'Tasks assigned to others',
        'listHeaders.notInList': 'Not in List',
        'listHeaders.notInListDescription': 'Orphaned tasks',
        'listHeaders.public': 'Public',
        'listHeaders.publicDescription': 'Public tasks',
        'navigation.myTasks': 'My Tasks',
        'navigation.today': 'Today',
        'navigation.lists': 'Lists',
        'navigation.addList': 'Add List',
        'navigation.publicSharedLists': 'Public Shared Lists',
        'navigation.publicLists': 'Public Lists',
        'userMenu.settings': 'Settings',
        'userMenu.refreshData': 'Refresh Data',
        'userMenu.refreshing': 'Refreshing...',
        'userMenu.signOut': 'Sign out',
        'userMenu.signingOut': 'Signing out...',
        'settings.settings': 'Settings',
        'settings.remindersNotifications': 'Reminders & Notifications',
        'settingsPages.accountAccess.title': 'Account & Access',
        'settingsPages.accountAccess.description': 'Profile, email verification, and access settings',
        'settingsPages.remindersNotifications.title': 'Reminders & Notifications',
        'settingsPages.remindersNotifications.description': 'Configure reminders, push notifications, and calendar integration',
        'settingsPages.contacts.title': 'Contacts',
        'settingsPages.contacts.description': 'Import contacts for collaborator suggestions',
        'settingsPages.apiAccess.title': 'API Access',
        'settingsPages.apiAccess.description': 'OAuth applications and API integrations',
        'settingsPages.chatgpt.title': 'ChatGPT Integration',
        'settingsPages.chatgpt.description': 'Connect Astrid to custom GPT actions',
        'settingsPages.appearance.title': 'Appearance',
        'settingsPages.appearance.description': 'Customize theme, colors, and visual preferences',
        'settingsPages.debug.title': 'Debug',
        'settingsPages.debug.description': 'Developer options and debugging features',
        'settingsPages.manageAccount': 'Manage your account and preferences',
        // Appearance page translations
        'settingsPages.appearancePage.title': 'Appearance and User Experience',
        'settingsPages.appearancePage.description': 'Customize the look, feel, and workflow of your interface',
        'settingsPages.appearancePage.theme.title': 'Theme',
        'settingsPages.appearancePage.theme.description': 'Choose between Ocean, light, and dark themes',
        'settingsPages.appearancePage.theme.ocean': 'Ocean',
        'settingsPages.appearancePage.theme.oceanDesc': 'Light theme with a refreshing cyan background',
        'settingsPages.appearancePage.theme.light': 'Light Mode',
        'settingsPages.appearancePage.theme.lightDesc': 'A bright, clean interface perfect for daytime use',
        'settingsPages.appearancePage.theme.dark': 'Dark Mode',
        'settingsPages.appearancePage.theme.darkDesc': 'A sleek, dark interface that\'s easier on the eyes in low light',
        'settingsPages.appearancePage.theme.proTip': 'Your theme preference is saved automatically and will be applied across all your devices.',
        'settingsPages.appearancePage.keyboard.title': 'Keyboard Shortcuts',
        'settingsPages.appearancePage.keyboard.description': 'View and learn keyboard shortcuts to navigate faster',
        'settingsPages.appearancePage.keyboard.viewShortcuts': 'View Shortcuts',
        'settingsPages.appearancePage.keyboard.viewTitle': 'View Keyboard Shortcuts',
        'settingsPages.appearancePage.keyboard.viewDesc': 'See all available keyboard shortcuts for efficient task management',
        'settingsPages.appearancePage.keyboard.quickAccess': 'Press ? anywhere in the task manager to open keyboard shortcuts.',
        'settingsPages.appearancePage.emailToTask.title': 'Email-to-Task',
        'settingsPages.appearancePage.emailToTask.description': 'Create tasks instantly by sending emails to remindme@astrid.cc',
        'settingsPages.appearancePage.emailToTask.threeWays': 'Three Ways to Create Tasks',
        'settingsPages.appearancePage.emailToTask.selfTask': 'Self-task:',
        'settingsPages.appearancePage.emailToTask.assignedTask': 'Assigned task:',
        'settingsPages.appearancePage.emailToTask.groupTask': 'Group task:',
        'settingsPages.appearancePage.emailToTask.configure': 'Configure Email Settings',
        'settingsPages.appearancePage.emailToTask.configureDesc': 'Customize default due dates, enable/disable the feature, and more',
        'settingsPages.appearancePage.emailToTask.proTip': 'The email subject becomes your task title, and the body becomes the description. Perfect for quick task capture from your inbox!',
        'messages.loading': 'Loading...',
        'messages.success': 'Success!',
        'messages.error': 'Error',
        'messages.cacheCleared': 'Cache cleared',
        'messages.dataRefreshed': 'Data has been refreshed',
        // Empty state messages
        'emptyState.featured': 'This list is empty right now! Copy it to make it your own and start adding tasks.',
        'emptyState.today': 'Nothing scheduled for today! Enjoy the free time, or add something new.',
        'emptyState.myTasks': "You're all caught up! No tasks assigned to you right now. Time to relax!",
        'emptyState.assigned': 'No tasks assigned yet! Check back later or create tasks for your team.',
        'emptyState.notInList': 'No orphaned tasks! All your tasks are organized in lists.',
        'emptyState.shared': 'Start collaborating! Add a task to get this shared list going.',
        'emptyState.public': 'Share your ideas with the world! Add tasks - anyone can see this public list.',
        'emptyState.personal': 'Ready to capture your thoughts? Tap add a task to create your first task!',
        'emptyState.default': "Let's fill up \"{listName}\"! Add your first task to get started.",
        'emptyState.defaultNoName': 'Time to get organized! Add your first task to get started.',
        'emptyState.addTaskHint': 'Add task',
        'emptyState.noLists': 'No lists yet. Create your first list to get started!',
      }
      // Fall back to the real en.json before giving up and echoing the key.
      // The map above only covers keys someone remembered to add; without this,
      // any newly translated string silently renders as "tasks.addTaskShort"
      // and every test asserting on that copy breaks for no real reason.
      const fromLocale = key.split('.').reduce<unknown>(
        (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
        enMessages as unknown,
      )
      let value = translations[key] || (typeof fromLocale === 'string' ? fromLocale : key)
      if (params) {
        Object.entries(params).forEach(([paramKey, paramValue]) => {
          value = value.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), paramValue)
        })
      }
      return value
    }
  })),
  useLocale: vi.fn(() => 'en'),
}))

// Mock Redis client
vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0)
  },
  isRedisAvailable: vi.fn().mockResolvedValue(false),
  RedisCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    delPattern: vi.fn().mockResolvedValue(undefined),
    getOrSet: vi.fn().mockImplementation((key, fetchFn) => fetchFn()),
    keys: {
      user: vi.fn((userId) => `user:${userId}`),
      userTasks: vi.fn((userId) => `tasks:user:${userId}`),
      userLists: vi.fn((userId) => `lists:user:${userId}`),
      userListsV1: vi.fn((userId) => `lists:user:${userId}:v1`),
      listTasks: vi.fn((listId) => `tasks:list:${listId}`),
      listMembers: vi.fn((listId) => `members:list:${listId}`),
      publicTasks: vi.fn(() => 'tasks:public'),
      userSearch: vi.fn((query) => `users:search:${query}`),
      taskComments: vi.fn((taskId) => `comments:task:${taskId}`)
    },
    invalidate: {
      userTasks: vi.fn().mockResolvedValue(undefined),
      userLists: vi.fn().mockResolvedValue(undefined),
      userListsAllVersions: vi.fn().mockResolvedValue(undefined),
      taskUpdate: vi.fn().mockResolvedValue(undefined),
      listUpdate: vi.fn().mockResolvedValue(undefined)
    }
  }
}))
