/**
 * User Settings Hook
 *
 * Manages user settings synced across devices via database + SSE.
 * Currently handles:
 * - smartTaskCreationEnabled: Parse dates, priorities, hashtags from task titles
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSSESubscription } from './use-sse-subscription'
import { useToast } from './use-toast'
import {
  DEFAULT_TASK_DISPLAY_MODE,
  normalizeTaskDisplayMode,
  type TaskDisplayMode,
} from '@/lib/task-display-mode'

export interface UserSettings {
  smartTaskCreationEnabled: boolean
  emailToTaskEnabled: boolean
  defaultTaskDueOffset: string
  defaultDueTime: string
  /** "indented" (subtasks in lists, indented) | "under_parent" (detail only) */
  subtaskDisplay: string
  /** "list" | "project" — which task-detail design this user sees. */
  taskDisplayMode: string
}

const DEFAULT_SETTINGS: UserSettings = {
  smartTaskCreationEnabled: true,
  emailToTaskEnabled: true,
  defaultTaskDueOffset: '1_week',
  defaultDueTime: '17:00',
  subtaskDisplay: 'indented',
  taskDisplayMode: DEFAULT_TASK_DISPLAY_MODE,
}

export function useUserSettings() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch initial settings from API
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/v1/users/me/smart-tasks')
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
  /**
   * Apply a settings change optimistically, then persist it (task 9523d634).
   *
   * A REJECTED WRITE NOW ROLLS BACK. This used to log to the console and stop,
   * so the switch stayed in its new position while the server had stored
   * nothing — the user only found out when a reload silently undid it.
   *
   * ONLY THE ATTEMPTED KEYS revert. Other writes may land while a slow one is
   * in flight, and restoring the whole object would undo them too.
   */
  const updateSettings = useCallback(async (updates: Partial<UserSettings>) => {
    // What these keys were before the optimistic change, so a failure can put
    // exactly them back.
    let previous: Partial<UserSettings> = {}
    setSettings(prev => {
      previous = Object.fromEntries(
        Object.keys(updates).map(key => [key, prev[key as keyof UserSettings]]),
      ) as Partial<UserSettings>
      return { ...prev, ...updates }
    })

    const revert = (reason: string) => {
      setSettings(prev => ({ ...prev, ...previous }))
      toast({
        title: 'Setting not saved',
        description: 'Your change was reverted. Please try again.',
        variant: 'destructive',
      })
      console.error(`[UserSettings] ${reason}`)
    }

    // Debounce API call (300ms)
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }

    updateTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch('/api/v1/users/me/smart-tasks', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })

        if (!response.ok) {
          revert(`Failed to update settings: ${response.status}`)
        }
      } catch (error) {
        revert(`Error updating settings: ${String(error)}`)
      }
    }, 300)
     
  }, [toast])

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
    // Normalized at the boundary so no consumer compares the raw string. The
    // server can send null for a row written before the column existed, and an
    // older client can send a mode this build does not know; both must render
    // the safe layout rather than neither (task ffa5bbb5).
    taskDisplayMode: normalizeTaskDisplayMode(settings.taskDisplayMode) as TaskDisplayMode,
  }
}
