const CACHE_NAME = 'astrid-v1.0.7';
const STATIC_CACHE_NAME = 'astrid-static-v1.0.7';
const DYNAMIC_CACHE_NAME = 'astrid-dynamic-v1.0.7';

// Import Dexie for IndexedDB access in service worker
// Note: Using CDN version for service worker context
importScripts('https://unpkg.com/dexie@4.0.1/dist/dexie.min.js');

// Static assets to cache immediately (only files that exist)
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/maskable-icon-192x192.png',
  '/icons/icon-256x256.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  '/icons/maskable-icon-512x512.png',
  '/help',
  '/privacy',
  '/terms',
];

// API routes that should be cached
const API_ROUTES = [
  '/api/tasks',
  '/api/lists',
  '/api/auth/session',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        // Cache assets individually to avoid failing on missing files
        return Promise.allSettled(
          STATIC_ASSETS.map(asset =>
            cache.add(asset).catch(() => {
              // Silently skip assets that fail to cache
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Skip requests to external domains - let browser handle them directly
  // This prevents CSP issues with external resources like Google profile images
  if (url.origin !== self.location.origin) {
    return;
  }

  // Handle different types of requests
  if (url.pathname.startsWith('/api/')) {
    // API requests - network first with cache fallback
    event.respondWith(handleApiRequest(request));
  } else if (url.pathname.startsWith('/_next/static/')) {
    // Static assets - cache first
    event.respondWith(handleStaticRequest(request));
  } else if (url.pathname === '/' || url.pathname.startsWith('/list/') || url.pathname.startsWith('/settings')) {
    // App pages - network first with cache fallback
    event.respondWith(handlePageRequest(request));
  } else {
    // Other requests - network first
    event.respondWith(fetch(request));
  }
});

// Handle API requests
async function handleApiRequest(request) {
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache successful responses
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Network failed, trying cache
    
    // Fallback to cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline response for API requests
    return new Response(
      JSON.stringify({ 
        error: 'Offline', 
        message: 'You are offline. Please check your connection.' 
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Handle static asset requests
async function handleStaticRequest(request) {
  // Try cache first
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    // Fallback to network
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Failed to fetch static asset
    throw error;
  }
}

// Handle page requests
async function handlePageRequest(request) {
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache successful responses
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Network failed, trying cache
    
    // Fallback to cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Fallback to index.html for SPA routing
    if (request.mode === 'navigate') {
      const indexResponse = await caches.match('/');
      if (indexResponse) {
        return indexResponse;
      }
    }
    
    throw error;
  }
}

// Handle background sync for offline actions
self.addEventListener('sync', (event) => {

  if (event.tag === 'background-sync' || event.tag === 'sync-mutations') {
    event.waitUntil(doBackgroundSync());
  } else if (event.tag === 'sync-data') {
    event.waitUntil(doDataSync());
  }
});

async function doBackgroundSync() {

  // Get pending actions from IndexedDB
  try {
    const pendingActions = await getPendingActions();

    if (pendingActions.length === 0) {
      return;
    }


    let successCount = 0;
    let failedCount = 0;

    for (const action of pendingActions) {
      try {
        const response = await syncAction(action);

        // Handle ID mapping for creates
        if (action.type === 'create' && action.tempId) {
          const responseData = await response.json();
          if (responseData.id && responseData.id !== action.tempId) {
            // Save ID mapping
            await db.idMappings.put({
              tempId: action.tempId,
              realId: responseData.id,
              entity: action.entity,
              timestamp: Date.now()
            });

            // Remove temp entity
            if (action.entity === 'task') {
              await db.tasks.delete(action.tempId);
            } else if (action.entity === 'list') {
              await db.lists.delete(action.tempId);
            } else if (action.entity === 'comment') {
              await db.comments.delete(action.tempId);
            }

          }
        }

        await removePendingAction(action.id);
        successCount++;
      } catch (error) {

        // Update retry count
        const retryCount = (action.retryCount || 0) + 1;
        if (retryCount >= 3) {
          // Mark as failed after 3 retries
          await db.mutations.update(action.id, {
            status: 'failed',
            retryCount,
            lastError: error.message
          });
        } else {
          await db.mutations.update(action.id, { retryCount });
        }
        failedCount++;
      }
    }


    // Notify clients of sync completion
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        data: { success: successCount, failed: failedCount }
      });
    });

  } catch (error) {
  }
}

// Perform full data sync (fetch latest from server)
async function doDataSync() {

  try {
    // Fetch latest tasks
    const tasksResponse = await fetch('/api/tasks', { credentials: 'include' });
    if (tasksResponse.ok) {
      const tasksData = await tasksResponse.json();
      const tasks = tasksData.tasks || tasksData || [];

      // Bulk update IndexedDB
      await db.transaction('rw', db.tasks, async () => {
        for (const task of tasks) {
          await db.tasks.put(task);
        }
      });

    }

    // Fetch latest lists
    const listsResponse = await fetch('/api/lists', { credentials: 'include' });
    if (listsResponse.ok) {
      const listsData = await listsResponse.json();
      const lists = listsData.lists || listsData || [];
      const serverListIds = new Set(lists.map(l => l.id));

      await db.transaction('rw', db.lists, async () => {
        // Remove lists that no longer exist on server
        const localLists = await db.lists.toArray();
        for (const localList of localLists) {
          if (!serverListIds.has(localList.id)) {
            await db.lists.delete(localList.id);
          }
        }
        // Update/add lists from server
        for (const list of lists) {
          await db.lists.put(list);
        }
      });

    }

    // Update sync cursor
    await db.syncCursors.put({
      entity: 'task',
      cursor: new Date().toISOString(),
      lastSync: Date.now()
    });

    await db.syncCursors.put({
      entity: 'list',
      cursor: new Date().toISOString(),
      lastSync: Date.now()
    });

    // Notify clients
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'DATA_SYNC_COMPLETE',
        data: { timestamp: Date.now() }
      });
    });

  } catch (error) {
  }
}

// Initialize IndexedDB connection for offline sync
const db = new Dexie('AstridOfflineDB');

// Version 1: Original schema
db.version(1).stores({
  tasks: 'id, listId, assignedToId, dueDate, completed, updatedAt',
  lists: 'id, ownerId, privacy, updatedAt, isFavorite',
  users: 'id, email',
  publicTasks: 'id, listId, updatedAt',
  mutations: 'id, type, entity, entityId, timestamp, status'
});

// Version 2: Add comments, idMappings
db.version(2).stores({
  tasks: 'id, listId, assignedToId, dueDate, completed, updatedAt',
  lists: 'id, ownerId, privacy, updatedAt, isFavorite',
  users: 'id, email',
  publicTasks: 'id, listId, updatedAt',
  comments: 'id, taskId, authorId, createdAt',
  mutations: 'id, type, entity, entityId, timestamp, status, parentId',
  idMappings: 'tempId, realId, entity, timestamp'
});

// Version 3: Add listMembers, attachments, syncCursors for full offline support
db.version(3).stores({
  tasks: 'id, listId, assignedToId, dueDate, completed, updatedAt',
  lists: 'id, ownerId, privacy, updatedAt, isFavorite',
  users: 'id, email',
  publicTasks: 'id, listId, updatedAt',
  comments: 'id, taskId, authorId, createdAt',
  mutations: 'id, type, entity, entityId, timestamp, status, parentId',
  idMappings: 'tempId, realId, entity, timestamp',
  listMembers: 'id, listId, userId, role, syncStatus',
  attachments: 'id, taskId, commentId, cachedAt, accessedAt, syncStatus',
  syncCursors: 'entity, lastSync'
});

// Helper functions for IndexedDB operations
async function getPendingActions() {
  try {
    // Get pending mutations from IndexedDB
    const mutations = await db.mutations
      .where('status')
      .equals('pending')
      .sortBy('timestamp');

    return mutations || [];
  } catch (error) {
    return [];
  }
}

async function syncAction(mutation) {
  // Sync the mutation with the server
  const response = await fetch(mutation.endpoint, {
    method: mutation.method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: mutation.data ? JSON.stringify(mutation.data) : undefined,
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status} ${response.statusText}`);
  }

  return response;
}

async function removePendingAction(actionId) {
  try {
    // Remove the synced mutation from IndexedDB
    await db.mutations.delete(actionId);
  } catch (error) {
  }
}

// Handle push notifications
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body,
      icon: data.icon || '/icons/icon-192x192.png',
      badge: data.badge || '/icons/icon-72x72.png',
      vibrate: [100, 50, 100],
      data: data.data,
      actions: data.actions || [
        {
          action: 'open',
          title: 'Open App',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        }
      ],
      requireInteraction: true, // Keep notification until user interacts
      tag: data.data?.taskId ? `task-${data.data.taskId}` : 'general' // Group notifications by task
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const notificationData = event.notification.data || {};
  const action = event.action;
  
  
  if (action === 'snooze_15') {
    // Handle snooze action
    event.waitUntil(handleSnoozeAction(notificationData, 15));
  } else if (action === 'snooze_60') {
    // Handle 1 hour snooze
    event.waitUntil(handleSnoozeAction(notificationData, 60));
  } else if (action === 'complete') {
    // Handle complete action
    event.waitUntil(handleCompleteAction(notificationData));
  } else if (action === 'dismiss') {
    // Just close the notification (already done above)
  } else {
    // Default action - open the app with deep linking
    const targetUrl = notificationData.url || '/';
    event.waitUntil(openAppWindow(targetUrl));
  }
});

// Helper function to open app window with proper deep linking
async function openAppWindow(url) {
  try {
    // Check if app is already open
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });
    
    // If app is already open, focus and navigate to the URL
    for (const client of clients) {
      if (client.url.includes(self.location.origin)) {
        await client.focus();
        if (url !== '/') {
          // Navigate to specific task/page
          client.postMessage({
            type: 'NAVIGATE',
            url: url
          });
        }
        return;
      }
    }
    
    // App is not open, open new window
    await self.clients.openWindow(url);
  } catch (error) {
  }
}

// Handle snooze action
async function handleSnoozeAction(notificationData, minutes) {
  try {
    if (!notificationData.taskId) {
      return;
    }
    
    const response = await fetch(`/api/reminders/${notificationData.taskId}/snooze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ minutes })
    });
    
    if (response.ok) {
      // Show success notification
      await self.registration.showNotification('Task Snoozed', {
        body: `Reminder snoozed for ${minutes} minutes`,
        icon: '/icons/icon-192x192.png',
        tag: 'snooze-success',
        silent: true,
        actions: []
      });
    } else {
      throw new Error(`Snooze failed: ${response.status}`);
    }
  } catch (error) {
    // Show error notification
    await self.registration.showNotification('Snooze Failed', {
      body: 'Failed to snooze reminder. Please try again.',
      icon: '/icons/icon-192x192.png',
      tag: 'snooze-error'
    });
  }
}

// Handle complete action
async function handleCompleteAction(notificationData) {
  try {
    if (!notificationData.taskId) {
      return;
    }
    
    const response = await fetch(`/api/tasks/${notificationData.taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ completed: true })
    });
    
    if (response.ok) {
      // Show success notification
      await self.registration.showNotification('Task Completed', {
        body: 'Task marked as complete!',
        icon: '/icons/icon-192x192.png',
        tag: 'complete-success',
        silent: true,
        actions: []
      });
    } else {
      throw new Error(`Complete failed: ${response.status}`);
    }
  } catch (error) {
    // Show error notification
    await self.registration.showNotification('Complete Failed', {
      body: 'Failed to mark task as complete. Please try again.',
      icon: '/icons/icon-192x192.png',
      tag: 'complete-error'
    });
  }
}

// Client-side reminder scheduling
let scheduledReminders = new Map(); // Store scheduled reminder timeouts

// Handle messages from the main app
self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};
  
  if (type === 'NAVIGATE_RESPONSE') {
    // Main app has handled the navigation
  } else if (type === 'SCHEDULE_REMINDER') {
    // Schedule a client-side reminder
    scheduleClientReminder(data);
  } else if (type === 'CANCEL_REMINDER') {
    // Cancel a client-side reminder
    cancelClientReminder(data.taskId);
  } else if (type === 'SYNC_REMINDERS') {
    // Sync reminders with server
    syncRemindersWithServer(data.reminders);
  }
});

// Schedule a client-side reminder
function scheduleClientReminder(reminderData) {
  try {
    const { taskId, title, scheduledFor, type, userId } = reminderData;
    const scheduledTime = new Date(scheduledFor);
    const now = new Date();
    
    if (scheduledTime <= now) {
      return;
    }
    
    const delay = scheduledTime.getTime() - now.getTime();
    
    // Cancel any existing reminder for this task
    cancelClientReminder(taskId);
    
    // Schedule the new reminder
    const timeoutId = setTimeout(async () => {
      await showClientReminder({
        taskId,
        title,
        type,
        userId,
        scheduledFor: scheduledTime
      });
      
      // Remove from scheduled reminders
      scheduledReminders.delete(taskId);
    }, delay);
    
    // Store the timeout ID
    scheduledReminders.set(taskId, {
      timeoutId,
      reminderData,
      scheduledFor: scheduledTime
    });
    
  } catch (error) {
  }
}

// Cancel a client-side reminder
function cancelClientReminder(taskId) {
  const scheduled = scheduledReminders.get(taskId);
  if (scheduled) {
    clearTimeout(scheduled.timeoutId);
    scheduledReminders.delete(taskId);
  }
}

// Show a client-side reminder notification
async function showClientReminder(reminderData) {
  try {
    // Check notification permission first
    if (Notification.permission !== 'granted') {
      return;
    }

    const { taskId, title, type } = reminderData;

    let notificationTitle = 'Task Reminder';
    let notificationBody = title;

    if (type === 'overdue_reminder') {
      notificationTitle = 'Task Overdue';
      notificationBody = `${title} is overdue`;
    } else if (type === 'due_reminder') {
      notificationTitle = 'Task Due';
      notificationBody = `${title} is due now`;
    }

    const options = {
      body: notificationBody,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [100, 50, 100],
      data: {
        taskId,
        action: 'task_reminder',
        url: `/tasks/${taskId}`,
        source: 'client-side'
      },
      actions: [
        { action: 'open', title: 'View Task' },
        { action: 'snooze_15', title: 'Snooze 15min' },
        { action: 'complete', title: 'Mark Complete' }
      ],
      requireInteraction: true,
      tag: `task-${taskId}`
    };

    await self.registration.showNotification(notificationTitle, options);
  } catch (error) {
    // Silently fail - notification errors are not critical
  }
}

// Sync reminders with server data
function syncRemindersWithServer(serverReminders) {
  try {
    // Cancel all existing client-side reminders
    for (const [taskId] of scheduledReminders) {
      cancelClientReminder(taskId);
    }
    
    // Schedule new reminders based on server data
    for (const reminder of serverReminders) {
      if (reminder.status === 'pending') {
        scheduleClientReminder(reminder);
      }
    }
    
  } catch (error) {
  }
}

// Clean up expired reminders periodically
setInterval(() => {
  const now = new Date();
  for (const [taskId, scheduled] of scheduledReminders) {
    if (scheduled.scheduledFor < now) {
      cancelClientReminder(taskId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes
