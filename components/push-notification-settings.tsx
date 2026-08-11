"use client"

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Bell, BellOff, AlertCircle, CheckCircle } from 'lucide-react'

interface PushNotificationSettingsProps {
  className?: string
}

interface SubscriptionStatus {
  isSupported: boolean
  permission: NotificationPermission | 'unsupported'
  isSubscribed: boolean
  subscription?: PushSubscription | null
  error?: string
}

export function PushNotificationSettings({ className }: PushNotificationSettingsProps) {
  const [status, setStatus] = useState<SubscriptionStatus>({
    isSupported: false,
    permission: 'unsupported',
    isSubscribed: false,
  })
  const [loading, setLoading] = useState(false)

  // Check current push notification status
  const checkNotificationStatus = async () => {
    if (typeof window === 'undefined') return

    const isSupported = 'serviceWorker' in navigator && 'PushManager' in window
    
    if (!isSupported) {
      setStatus({
        isSupported: false,
        permission: 'unsupported',
        isSubscribed: false,
        error: 'Push notifications are not supported in this browser'
      })
      return
    }

    const permission = Notification.permission
    let isSubscribed = false
    let subscription: PushSubscription | null = null

    if (permission === 'granted') {
      try {
        const registration = await navigator.serviceWorker.ready
        subscription = await registration.pushManager.getSubscription()
        isSubscribed = !!subscription
      } catch (error) {
        console.error('Failed to check subscription:', error)
      }
    }

    setStatus({
      isSupported,
      permission,
      isSubscribed,
      subscription,
    })
  }

  // Enable push notifications
  const enableNotifications = async () => {
    if (!status.isSupported) return

    setLoading(true)
    try {
      // Request permission
      const permission = await Notification.requestPermission()
      
      if (permission !== 'granted') {
        setStatus(prev => ({ 
          ...prev, 
          permission,
          error: 'Notification permission was denied. Please enable notifications in your browser settings.' 
        }))
        setLoading(false)
        return
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready
      
      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription()
      
      if (!subscription) {
        // Subscribe to push notifications
        const vapidPublicKey = 'BHStoaMao0kxQagtfs37EI8E8oj8HmN8HEPcM0QiEuroCpCuxJr9SUwFqX3ft5XShdCwX73Qv-mTj3tRnORVsDQ'
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidPublicKey
        })
      }

      // Send subscription to server
      const response = await fetch('/api/v1/users/me/push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.getKey('p256dh') ? btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')!))) : '',
            auth: subscription.getKey('auth') ? btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')!))) : ''
          },
          userAgent: navigator.userAgent
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to save subscription to server')
      }

      setStatus({
        isSupported: true,
        permission: 'granted',
        isSubscribed: true,
        subscription,
      })

    } catch (error) {
      console.error('Failed to enable notifications:', error)
      setStatus(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Failed to enable notifications'
      }))
    } finally {
      setLoading(false)
    }
  }

  // Disable push notifications
  const disableNotifications = async () => {
    if (!status.subscription) return

    setLoading(true)
    try {
      // Unsubscribe from push notifications
      await status.subscription.unsubscribe()

      // Mark subscription as inactive on server
      const response = await fetch(`/api/v1/users/me/push-subscriptions?endpoint=${encodeURIComponent(status.subscription.endpoint)}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        console.error('Failed to deactivate subscription on server')
      }

      setStatus(prev => ({
        ...prev,
        isSubscribed: false,
        subscription: null,
      }))
    } catch (error) {
      console.error('Failed to disable notifications:', error)
      setStatus(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to disable notifications'
      }))
    } finally {
      setLoading(false)
    }
  }

  // Send test notification
  const sendTestNotification = async () => {
    if (!status.isSubscribed) return

    setLoading(true)
    try {
      const response = await fetch('/api/debug/test-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'push_notification' })
      })

      const data = await response.json()
      if (!data.success) {
        throw new Error(data.message || data.error || 'Failed to send test notification')
      }

      // Clear any previous errors on success
      setStatus(prev => ({ ...prev, error: undefined }))
    } catch (error) {
      console.error('Test notification failed:', error)
      setStatus(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Test notification failed'
      }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    checkNotificationStatus()
  }, [])

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Push Notifications
        </CardTitle>
        <CardDescription>
          Get notified about task reminders and updates even when the app is closed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Display */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Notification Status</Label>
            <div className="flex items-center gap-2">
              {status.isSubscribed ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-green-600">Enabled</span>
                </>
              ) : status.permission === 'denied' ? (
                <>
                  <BellOff className="w-4 h-4 text-red-500" />
                  <span className="text-sm text-red-600">Blocked</span>
                </>
              ) : (
                <>
                  <BellOff className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-600">Disabled</span>
                </>
              )}
            </div>
          </div>
          
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>Enable Push Notifications</Label>
              <p className="text-xs text-muted-foreground">
                Receive task reminders and notifications
              </p>
            </div>
            <Switch 
              checked={status.isSubscribed}
              onCheckedChange={(checked) => {
                if (checked) {
                  enableNotifications()
                } else {
                  disableNotifications()
                }
              }}
              disabled={loading || !status.isSupported || status.permission === 'denied'}
            />
          </div>
        </div>

        {/* Error Display */}
        {status.error && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{status.error}</AlertDescription>
          </Alert>
        )}

        {/* Browser Instructions */}
        {status.permission === 'denied' && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Notifications are blocked. To enable:
              <br />• <strong>Chrome/Edge:</strong> Click the lock icon in the address bar → Notifications → Allow
              <br />• <strong>Firefox:</strong> Click the shield icon → Permissions → Allow notifications
              <br />• <strong>Safari:</strong> Safari → Settings → Websites → Notifications → Allow
            </AlertDescription>
          </Alert>
        )}

        {/* PWA Instructions */}
        {!status.isSubscribed && status.permission !== 'denied' && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>For best experience, install this app:</strong>
              <br />• <strong>Mobile:</strong> Tap &quot;Add to Home Screen&quot; in your browser menu
              <br />• <strong>Desktop:</strong> Look for the install icon in the address bar
              <br />• <strong>PWA benefits:</strong> Notifications work even when the app is closed
            </AlertDescription>
          </Alert>
        )}

        {/* Test Button */}
        {status.isSubscribed && (
          <div className="pt-4 border-t">
            <Button 
              variant="outline" 
              onClick={sendTestNotification}
              disabled={loading}
              className="w-full"
            >
              Send Test Notification
            </Button>
          </div>
        )}

        {/* Support Info */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Browser support: {status.isSupported ? '✅ Supported' : '❌ Not supported'}</p>
          <p>• Permission: {status.permission}</p>
          <p>• Subscription: {status.isSubscribed ? '✅ Active' : '❌ None'}</p>
        </div>
      </CardContent>
    </Card>
  )
}