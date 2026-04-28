'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createLogger } from '@/lib/logger'

const log = createLogger('[locale].debug-reminders.debug-reminders-client.tsx')


interface Reminder {
  id: string
  taskId: string
  type: string
  scheduledFor: string
  status: string
  data: any
}

interface DebugRemindersClientProps {
  defaultUserEmail: string
}

export function DebugRemindersClient({ defaultUserEmail }: DebugRemindersClientProps) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(false)
  const [testTaskTitle, setTestTaskTitle] = useState('Test Reminder Task')
  const [testMinutes, setTestMinutes] = useState(1)
  const [testUserEmail, setTestUserEmail] = useState(defaultUserEmail)
  const [mounted, setMounted] = useState(false)

  // Fetch current reminders from database
  const fetchReminders = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/reminders/status?userEmail=${encodeURIComponent(testUserEmail)}`)
      const data = await response.json()
      setReminders(data.reminders || [])
    } catch (error) {
      log.error({ err: error }, 'Failed to fetch reminders:')
    } finally {
      setLoading(false)
    }
  }, [testUserEmail])

  // Trigger cron job manually
  const triggerCronJob = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/cron/reminders', { method: 'POST' })
      const data = await response.json()
      log.info({ data }, 'Cron job result:')
      alert(`Cron job completed in ${data.duration || 'unknown time'}`)
      fetchReminders()
    } catch (error) {
      log.error({ err: error }, 'Failed to trigger cron job:')
      alert('Failed to trigger cron job')
    } finally {
      setLoading(false)
    }
  }

  // Create a test task with due date
  const createTestTask = async () => {
    setLoading(true)
    try {
      const dueDate = new Date(Date.now() + testMinutes * 60 * 1000)

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: testTaskTitle,
          description: `Test task created at ${new Date().toLocaleString()} for ${testUserEmail}`,
          dueDateTime: dueDate.toISOString(),
          priority: 1,
          isPrivate: false,
          listIds: [], // Create without lists for simplicity
          testUserEmail: testUserEmail // Add user email for testing
        })
      })

      if (response.ok) {
        const task = await response.json()
        alert(`Test task created with ID: ${task.id}\\nDue: ${dueDate.toLocaleString()}`)
        fetchReminders()
      } else {
        throw new Error(`Failed to create task: ${response.status}`)
      }
    } catch (error) {
      log.error({ err: error }, 'Failed to create test task:')
      alert('Failed to create test task')
    } finally {
      setLoading(false)
    }
  }

  // Test Service Worker communication
  const testServiceWorker = async () => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready

        // Send test message
        registration.active?.postMessage({
          type: 'SCHEDULE_REMINDER',
          data: {
            taskId: 'test-sw-' + Date.now(),
            title: 'Service Worker Test Reminder',
            scheduledFor: new Date(Date.now() + 30000), // 30 seconds
            type: 'due_reminder',
            userId: 'test-user'
          }
        })

        alert('Test message sent to Service Worker. Check console and expect notification in 30 seconds.')
      } catch (error) {
        log.error({ err: error }, 'Service Worker test failed:')
        alert('Service Worker test failed')
      }
    } else {
      alert('Service Workers not supported')
    }
  }

  // Set up push subscription for current browser
  const setupPushSubscription = async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Push notifications are not supported in this browser')
      return
    }

    try {
      // Request notification permission
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        alert('Notification permission denied. Please allow notifications to use push notifications.')
        return
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready

      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        alert('Already subscribed to push notifications!')
        return
      }

      // Subscribe to push notifications
      const vapidPublicKey = 'BHStoaMao0kxQagtfs37EI8E8oj8HmN8HEPcM0QiEuroCpCuxJr9SUwFqX3ft5XShdCwX73Qv-mTj3tRnORVsDQ'
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey
      })

      // Send subscription to server
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription,
          userEmail: testUserEmail
        })
      })

      if (response.ok) {
        alert(`Push subscription created for ${testUserEmail}! You can now receive push notifications.`)
      } else {
        const error = await response.json()
        throw new Error(error.message || 'Failed to save subscription')
      }
    } catch (error) {
      log.error({ err: error }, 'Push subscription setup failed:')
      alert(`Push subscription setup failed: ${(error as Error).message}`)
    }
  }

  // Test push notification
  const testPushNotification = async () => {
    try {
      const response = await fetch('/api/debug/test-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'push_notification',
          targetUserEmail: testUserEmail
        })
      })

      const data = await response.json()
      if (data.success) {
        alert(`Push notification sent to ${testUserEmail}! Check your notifications.`)
      } else {
        throw new Error(data.message || data.error || 'Unknown error')
      }
    } catch (error) {
      log.error({ err: error }, 'Push notification test failed:')
      alert(`Push notification test failed: ${(error as Error).message}`)
    }
  }

  useEffect(() => {
    setMounted(true)
    fetchReminders()
  }, [fetchReminders])

  // Show loading state until mounted to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Reminder System Debug</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Reminder System Debug</h1>
        <p className="text-muted-foreground">Test and debug the reminder system components</p>
      </div>

      <div className="grid gap-6">
        {/* User Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Test User Selection</CardTitle>
            <CardDescription>Select the user to test reminders for</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 items-center">
              <Input
                placeholder="User email"
                value={testUserEmail}
                onChange={(e) => setTestUserEmail(e.target.value)}
                className="flex-1"
              />
              <Button onClick={fetchReminders} disabled={loading}>
                Load User&apos;s Reminders
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Current test user: <strong>{testUserEmail}</strong>
            </p>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Tests</CardTitle>
            <CardDescription>Instant testing tools</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button onClick={fetchReminders} disabled={loading}>
                Refresh Reminders
              </Button>
              <Button onClick={triggerCronJob} disabled={loading}>
                Trigger Cron Job
              </Button>
              <Button onClick={testServiceWorker}>
                Test Service Worker
              </Button>
              <Button onClick={setupPushSubscription} variant="outline">
                Setup Push Subscription for {testUserEmail}
              </Button>
              <Button onClick={testPushNotification}>
                Test Push Notification for {testUserEmail}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Create Test Task */}
        <Card>
          <CardHeader>
            <CardTitle>Create Test Task</CardTitle>
            <CardDescription>Create a task with due date for testing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Task title"
                value={testTaskTitle}
                onChange={(e) => setTestTaskTitle(e.target.value)}
              />
              <Input
                type="number"
                placeholder="Minutes until due"
                value={testMinutes}
                onChange={(e) => setTestMinutes(Number(e.target.value))}
                className="w-40"
              />
              <Button onClick={createTestTask} disabled={loading}>
                Create Test Task
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Creates a task due in {testMinutes} minute(s) with automatic reminders for <strong>{testUserEmail}</strong>
            </p>
          </CardContent>
        </Card>

        {/* Current Reminders */}
        <Card>
          <CardHeader>
            <CardTitle>Current Reminders ({reminders.length})</CardTitle>
            <CardDescription>Database reminders currently scheduled for {testUserEmail}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p>Loading...</p>
            ) : reminders.length === 0 ? (
              <p className="text-muted-foreground">No reminders found for {testUserEmail}</p>
            ) : (
              <div className="space-y-2">
                {reminders.map((reminder) => (
                  <div
                    key={reminder.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div>
                      <div className="font-medium">
                        {reminder.data?.taskTitle || 'Unknown Task'}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Task ID: {reminder.taskId}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Scheduled: {new Date(reminder.scheduledFor).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant={reminder.type === 'due_reminder' ? 'default' : 'secondary'}>
                        {reminder.type}
                      </Badge>
                      <Badge variant={reminder.status === 'pending' ? 'outline' : 'secondary'}>
                        {reminder.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Service Worker Status */}
        <Card>
          <CardHeader>
            <CardTitle>Service Worker Status</CardTitle>
            <CardDescription>Check Service Worker registration and state</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="text-sm">
                <strong>Supported:</strong> {typeof window !== 'undefined' && 'serviceWorker' in navigator ? 'Yes' : 'No'}
              </div>
              <div className="text-sm">
                <strong>Registration:</strong> Check browser console for SW logs
              </div>
              <div className="text-sm">
                <strong>Active:</strong> Open DevTools → Application → Service Workers
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Testing Instructions</CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm max-w-none">
            <ol className="list-decimal list-inside space-y-2">
              <li><strong>Allow notifications</strong> when prompted by your browser</li>
              <li><strong>Select test user</strong> by entering their email address above</li>
              <li><strong>Create test task</strong> with due date 1-2 minutes from now</li>
              <li><strong>Check console</strong> for logs about scheduled reminders</li>
              <li><strong>Wait for notification</strong> to appear at scheduled time</li>
              <li><strong>Test notification actions</strong> (Complete, Snooze, View Task)</li>
              <li><strong>Test PWA closed</strong>: Close app completely, wait for notification</li>
            </ol>

            <p className="mt-4 text-sm text-muted-foreground">
              For full testing instructions, see <code>REMINDER_TESTING.md</code>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
