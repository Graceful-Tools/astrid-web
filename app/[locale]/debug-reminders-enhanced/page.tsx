"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Bell, Calendar, Clock, Play, RefreshCw, TestTube } from 'lucide-react'
import { PushNotificationSettings } from '@/components/push-notification-settings'
import { createLogger } from '@/lib/logger'

const log = createLogger('[locale].debug-reminders-enhanced.page.tsx')


interface ReminderQueueItem {
  id: string
  taskId: string
  userId: string
  scheduledFor: string
  type: string
  status: string
  data: any
  createdAt: string
}

interface TestTask {
  id: string
  title: string
  dueDateTime: string | null
  reminderTime: string | null
}

export default function EnhancedReminderDebugPage() {
  const { data: session } = useSession()
  const [loading, setLoading] = useState(false)
  const [reminderQueue, setReminderQueue] = useState<ReminderQueueItem[]>([])
  const [testResults, setTestResults] = useState<string[]>([])

  // Test task creation form
  const [taskTitle, setTaskTitle] = useState('Test Reminder Task')
  const [dueMinutes, setDueMinutes] = useState(2) // 2 minutes from now
  const [reminderMinutes, setReminderMinutes] = useState(1) // 1 minute from now

  // Add test result
  const addTestResult = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setTestResults(prev => [`[${timestamp}] ${message}`, ...prev])
  }, [])

  // Load reminder queue
  const loadReminderQueue = useCallback(async () => {
    try {
      const response = await fetch('/api/reminders/status')
      if (response.ok) {
        const data = await response.json()
        setReminderQueue(data.reminders || [])
      }
    } catch (error) {
      log.error({ err: error }, 'Failed to load reminder queue:')
      addTestResult('❌ Failed to load reminder queue')
    }
  }, [addTestResult])

  // Create test task with reminder
  const createTestTask = async () => {
    setLoading(true)
    try {
      const now = new Date()
      const dueDate = new Date(now.getTime() + dueMinutes * 60 * 1000)
      const reminderDate = new Date(now.getTime() + reminderMinutes * 60 * 1000)

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle,
          description: `Test task created at ${now.toLocaleString()} for reminder testing`,
          dueDateTime: dueDate.toISOString(),
          reminderTime: reminderDate.toISOString(),
          reminderType: 'both', // Both push and email
          priority: 1,
          listIds: [], // No specific list
        })
      })

      if (response.ok) {
        const task = await response.json()
        addTestResult(`✅ Created test task: ${task.title} (ID: ${task.id})`)
        addTestResult(`📅 Due: ${dueDate.toLocaleString()}`)
        addTestResult(`🔔 Reminder: ${reminderDate.toLocaleString()}`)
        await loadReminderQueue()
      } else {
        const error = await response.json()
        addTestResult(`❌ Failed to create task: ${error.error}`)
      }
    } catch (error) {
      addTestResult(`❌ Error creating task: ${error}`)
    } finally {
      setLoading(false)
    }
  }

  // Trigger manual reminder processing
  const triggerReminderProcessing = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/cron/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'due' })
      })

      if (response.ok) {
        const result = await response.json()
        addTestResult(`✅ Manual reminder processing completed: ${result.duration}`)
        await loadReminderQueue()
      } else {
        addTestResult('❌ Failed to trigger reminder processing')
      }
    } catch (error) {
      addTestResult(`❌ Error triggering reminder processing: ${error}`)
    } finally {
      setLoading(false)
    }
  }

  // Send test push notification
  const sendTestPushNotification = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/debug/test-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'push_notification' })
      })

      if (response.ok) {
        const result = await response.json()
        addTestResult('✅ Test push notification sent successfully')
      } else {
        const error = await response.json()
        addTestResult(`❌ Failed to send test notification: ${error.error}`)
      }
    } catch (error) {
      addTestResult(`❌ Error sending test notification: ${error}`)
    } finally {
      setLoading(false)
    }
  }

  // Clear test results
  const clearTestResults = () => {
    setTestResults([])
  }

  useEffect(() => {
    loadReminderQueue()
  }, [loadReminderQueue])

  if (!session) {
    return (
      <div className="container mx-auto p-6">
        <Alert>
          <AlertDescription>Please sign in to access reminder debugging tools.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2 mb-6">
        <TestTube className="w-6 h-6" />
        <h1 className="text-3xl font-bold">Enhanced Reminder Testing</h1>
      </div>

      {/* Push Notification Setup */}
      <PushNotificationSettings />

      {/* Test Task Creation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Create Test Task with Reminder
          </CardTitle>
          <CardDescription>
            Create a task with a reminder to test the end-to-end reminder flow
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="taskTitle">Task Title</Label>
              <Input
                id="taskTitle"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Enter task title"
              />
            </div>
            <div>
              <Label htmlFor="dueMinutes">Due in (minutes)</Label>
              <Input
                id="dueMinutes"
                type="number"
                value={dueMinutes}
                onChange={(e) => setDueMinutes(parseInt(e.target.value) || 2)}
                min="1"
                max="60"
              />
            </div>
            <div>
              <Label htmlFor="reminderMinutes">Reminder in (minutes)</Label>
              <Input
                id="reminderMinutes"
                type="number"
                value={reminderMinutes}
                onChange={(e) => setReminderMinutes(parseInt(e.target.value) || 1)}
                min="1"
                max="30"
              />
            </div>
          </div>
          <Button onClick={createTestTask} disabled={loading} className="w-full">
            <Calendar className="w-4 h-4 mr-2" />
            Create Test Task
          </Button>
        </CardContent>
      </Card>

      {/* Manual Testing Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="w-5 h-5" />
            Manual Testing Controls
          </CardTitle>
          <CardDescription>
            Manually trigger reminder processing and test notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button
              onClick={triggerReminderProcessing}
              disabled={loading}
              variant="outline"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Process Reminders
            </Button>
            <Button
              onClick={sendTestPushNotification}
              disabled={loading}
              variant="outline"
            >
              <Bell className="w-4 h-4 mr-2" />
              Test Push Notification
            </Button>
            <Button
              onClick={loadReminderQueue}
              disabled={loading}
              variant="outline"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh Queue
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reminder Queue Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Reminder Queue ({reminderQueue.length} items)
          </CardTitle>
          <CardDescription>
            Current reminders scheduled in the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reminderQueue.length === 0 ? (
            <p className="text-muted-foreground">No reminders in queue</p>
          ) : (
            <div className="space-y-2">
              {reminderQueue.slice(0, 10).map((reminder) => (
                <div key={reminder.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={reminder.status === 'pending' ? 'default' : 'secondary'}>
                        {reminder.status}
                      </Badge>
                      <Badge variant="outline">{reminder.type}</Badge>
                      <span className="text-sm font-medium">
                        {reminder.data?.taskTitle || `Task ${reminder.taskId?.slice(0, 8) || 'Unknown'}`}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Scheduled: {new Date(reminder.scheduledFor).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {reminder.id?.slice(0, 8) || 'No ID'}
                  </div>
                </div>
              ))}
              {reminderQueue.length > 10 && (
                <p className="text-sm text-muted-foreground text-center">
                  ... and {reminderQueue.length - 10} more
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Results Log */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Test Results Log</CardTitle>
            <CardDescription>Real-time testing output and results</CardDescription>
          </div>
          <Button onClick={clearTestResults} variant="outline" size="sm">
            Clear Log
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {testResults.length === 0 ? (
              <p className="text-muted-foreground text-sm">No test results yet</p>
            ) : (
              testResults.map((result, index) => (
                <div key={index} className="text-sm font-mono p-2 bg-muted rounded">
                  {result}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* System Information */}
      <Card>
        <CardHeader>
          <CardTitle>System Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <strong>User ID:</strong> {session.user.id}
            </div>
            <div>
              <strong>Email:</strong> {session.user.email}
            </div>
            <div>
              <strong>Service Worker:</strong> {'serviceWorker' in navigator ? '✅ Supported' : '❌ Not supported'}
            </div>
            <div>
              <strong>Push Manager:</strong> {'PushManager' in window ? '✅ Supported' : '❌ Not supported'}
            </div>
            <div>
              <strong>Notification Permission:</strong> {typeof Notification !== 'undefined' ? Notification.permission : 'unknown'}
            </div>
            <div>
              <strong>Current Time:</strong> {new Date().toLocaleString()}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}