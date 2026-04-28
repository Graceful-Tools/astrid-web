"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SSEManager } from '@/lib/sse-manager'
import { useSSESubscription, useSSEConnectionStatus, useTaskSSEEvents } from '@/hooks/use-sse-subscription'
import { useSession } from 'next-auth/react'
import { createLogger } from '@/lib/logger'

const log = createLogger('[locale].sse-test.page.tsx')


export default function SSETestPage() {
  const { data: session } = useSession()
  const [events, setEvents] = useState<any[]>([])
  const [testData, setTestData] = useState<any>(null)

  // Test connection status hook
  const connectionStatus = useSSEConnectionStatus()

  // Test general SSE subscription
  useSSESubscription(['*'], (event) => {
    log.info({ event }, '🔔 [SSE Test] Received event:')
    setEvents(prev => [...prev.slice(-9), { ...event, timestamp: new Date().toISOString() }])
  }, {
    componentName: 'SSETestPage'
  })

  // Test task-specific SSE events
  useTaskSSEEvents({
    onTaskCreated: (task) => {
      log.info({ task }, '🔔 [SSE Test] Task created:')
      setEvents(prev => [...prev.slice(-9), { type: 'task_created', data: task, timestamp: new Date().toISOString() }])
    },
    onTaskUpdated: (task) => {
      log.info({ task }, '🔔 [SSE Test] Task updated:')
      setEvents(prev => [...prev.slice(-9), { type: 'task_updated', data: task, timestamp: new Date().toISOString() }])
    },
    onTaskDeleted: (taskId) => {
      log.info({ taskId }, '🔔 [SSE Test] Task deleted:')
      setEvents(prev => [...prev.slice(-9), { type: 'task_deleted', data: { id: taskId }, timestamp: new Date().toISOString() }])
    }
  }, {
    componentName: 'SSETestPage-Tasks'
  })

  const getDebugInfo = () => {
    const debugInfo = SSEManager.getDebugInfo()
    setTestData(debugInfo)
  }

  const forceReconnect = () => {
    SSEManager.forceReconnect()
  }

  const triggerTestEvent = async () => {
    try {
      // Send a test event to the SSE endpoint
      const response = await fetch('/api/test-sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'test_event',
          message: 'Test event from SSE test page',
          timestamp: new Date().toISOString()
        })
      })

      if (!response.ok) {
        throw new Error(`Failed to trigger test event: ${response.statusText}`)
      }

      log.info('✅ Test event triggered successfully')
    } catch (error) {
      log.error({ err: error }, '❌ Failed to trigger test event:')
    }
  }

  const clearEvents = () => {
    setEvents([])
  }

  if (!session) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle>SSE Test Page</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Please sign in to test SSE functionality.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>SSE Manager Test Page</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={getDebugInfo}>Get Debug Info</Button>
            <Button onClick={forceReconnect} variant="outline">Force Reconnect</Button>
            <Button onClick={triggerTestEvent} variant="outline">Trigger Test Event</Button>
            <Button onClick={clearEvents} variant="destructive">Clear Events</Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Connection Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={connectionStatus.isConnected ? "default" : "destructive"}>
                      {connectionStatus.isConnected ? "Connected" : "Disconnected"}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Attempts: {connectionStatus.connectionAttempts}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Subscriptions: {connectionStatus.subscriptionCount}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Last Event: {connectionStatus.lastEventTime ? new Date(connectionStatus.lastEventTime).toLocaleTimeString() : 'Never'}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Events ({events.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {events.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No events received yet</p>
                  ) : (
                    events.slice().reverse().map((event, index) => (
                      <div key={index} className="p-2 bg-muted rounded text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{event.type}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        {event.data && (
                          <pre className="mt-1 text-xs overflow-hidden">
                            {JSON.stringify(event.data, null, 2).slice(0, 200)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {testData && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Debug Information</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
                  {JSON.stringify(testData, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  )
}