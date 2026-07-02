/**
 * User Settings Hook
 *
 * Manages user settings synced across devices via database + SSE.
 * Currently handles:
 * - smartTaskCreationEnabled: Parse dates, priorities, hashtags from task titles
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSSESubscription } from './use-sse-subscription'

export interface UserSettings {
  smartTaskCreationEnabled: boolean
  emailToTaskEnabled: boolean
  defaultTaskDueOffset: string
  defaultDueTime: string
  /** "indented" (subtasks in lists, indented) | "under_parent" (detail only) */
  subtaskDisplay: string
}

const DEFAULT_SETTINGS: UserSettings = {
  smartTaskCreationEnabled: true,
  emailToTaskEnabled: true,
  defaultTaskDueOffset: '1_week',
  defaultDueTime: '17:00',
  subtaskDisplay: 'indented',
}

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch initial settings from API
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/user/settings')
        if (response.ok) {
          const data = await response.json()
          setSettings(prev => ({ ...prev, ...data }))
        }
      } catch (error) {
        console.error('Failed to fetch user settings:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchSettings()
  }, [])

  // Listen for SSE updates from other devices/sessions
  useSSESubscription(
    'user_settings_updated',
    useCallback((event) => {
      if (event.data) {
        setSettings(prev => ({ ...prev, ...event.data }))
      }
    }, []),
    { componentName: 'UserSettings' }
  )

  // Update settings on server with debouncing
  const updateSettings = useCallback(async (updates: Partial<UserSettings>) => {
    // Optimistically update local state
    setSettings(prev => ({ ...prev, ...updates }))

    // Debounce API call (300ms)
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }

    updateTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch('/api/user/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })

        if (!response.ok) {
          console.error('[UserSettings] Failed to update settings:', response.status)
        }
      } catch (error) {
        console.error('[UserSettings] Error updating settings:', error)
      }
    }, 300)
  }, [])

  // Individual setters
  const setSmartTaskCreationEnabled = useCallback((value: boolean) => {
    updateSettings({ smartTaskCreationEnabled: value })
  }, [updateSettings])

  return {
    settings,
    isLoading,
    updateSettings,
    setSmartTaskCreationEnabled,
    // Convenience getter for smart task creation
    smartTaskCreationEnabled: settings.smartTaskCreationEnabled,
    subtaskDisplay: settings.subtaskDisplay,
  }
}
