"use client"

import { useState, useEffect, useRef } from "react"
import { AstridReminderPopover } from "./astrid-reminder-popover"
import { useReminders, ActiveReminder } from "@/lib/reminder-manager"
import { useClientReminderSync } from "@/lib/client-reminder-sync"
import { Task, User } from "@/types/task"

interface ReminderProviderProps {
  currentUser: User
  tasks: Task[]
  onTaskComplete: (taskId: string) => void
  onTaskUpdate: (task: Task) => void
  children: React.ReactNode
}

export function ReminderProvider({ 
  currentUser, 
  tasks, 
  onTaskComplete, 
  onTaskUpdate,
  children 
}: ReminderProviderProps) {
  const { 
    activeReminders, 
    snoozeReminder, 
    dismissReminder, 
    completeTask,
    updateTaskReminders,
    triggerManualReminder
  } = useReminders(currentUser.id)
  
  // Client-side reminder sync for Service Worker
  const {
    scheduleTaskReminders: scheduleClientReminders,
    cancelTaskReminders: cancelClientReminders,
    updateTaskReminders: updateClientReminders,
    syncAllReminders
  } = useClientReminderSync(currentUser.id)

  const [displayedReminders, setDisplayedReminders] = useState<ActiveReminder[]>([])
  const processedTasksRef = useRef<Set<string>>(new Set())

  // Update task reminders when tasks change - but avoid infinite loops
  useEffect(() => {
    const tasksWithDueDates = tasks.filter(task => !task.completed && (task.dueDateTime || task.reminderTime))

    // Only process tasks that haven't been processed recently or have changed
    const tasksToProcess = tasksWithDueDates.filter(task => {
      const taskKey = `${task.id}-${task.dueDateTime}-${task.reminderTime}-${task.completed}`
      const alreadyProcessed = processedTasksRef.current.has(taskKey)
      
      if (!alreadyProcessed) {
        processedTasksRef.current.add(taskKey)
        return true
      }
      return false
    })

    // Clean up old processed tasks to prevent memory leaks
    if (processedTasksRef.current.size > 1000) {
      processedTasksRef.current.clear()
    }

    // Only update reminders for tasks that actually need processing
    tasksToProcess.forEach(task => {
      // Update both in-memory and client-side reminders
      updateTaskReminders(task)
      updateClientReminders(task)
    })
  }, [tasks, updateTaskReminders, updateClientReminders])

  // Handle displaying reminders (limit to one at a time for better UX)
  useEffect(() => {
    if (activeReminders.length > 0 && displayedReminders.length === 0) {
      setDisplayedReminders([activeReminders[0]])
    }
  }, [activeReminders, displayedReminders])

  const handleComplete = async (taskId: string) => {
    try {
      // Mark task as complete in the app
      await onTaskComplete(taskId)
      
      // Remove reminders for this task (both in-memory and client-side)
      completeTask(taskId)
      cancelClientReminders(taskId)
      
      // Remove from displayed reminders
      setDisplayedReminders(prev => prev.filter(r => r.task.id !== taskId))
    } catch (error) {
      console.error('Failed to complete task:', error)
    }
  }

  const handleSnooze = (taskId: string, minutes: number) => {
    const reminder = displayedReminders.find(r => r.task.id === taskId)
    if (reminder) {
      snoozeReminder(reminder.id, minutes)
      setDisplayedReminders(prev => prev.filter(r => r.task.id !== taskId))
      // Persist the snooze as the task's reminderTime, as the native apps and the
      // notification do, so it survives a reload and shows on other devices (AWTD-1418).
      const fullTask = getTaskForReminder(reminder)
      if (fullTask) {
        onTaskUpdate({ ...fullTask, reminderTime: new Date(Date.now() + minutes * 60 * 1000) })
      }
    }
  }

  const handleDismiss = (reminderId?: string) => {
    if (reminderId) {
      dismissReminder(reminderId)
    }
    
    // Remove the first reminder from display and show next one if available
    setDisplayedReminders(prev => {
      const newList = prev.slice(1)
      if (newList.length === 0 && activeReminders.length > 1) {
        // Show next reminder
        const nextReminder = activeReminders.find(r => !displayedReminders.some(d => d.id === r.id))
        return nextReminder ? [nextReminder] : []
      }
      return newList
    })
  }

  // Get full task data for reminder
  const getTaskForReminder = (reminder: ActiveReminder): Task | null => {
    return tasks.find(task => task.id === reminder.config.taskId) || null
  }

  return (
    <>
      {children}
      
      {/* Render reminder popovers */}
      {displayedReminders.map(reminder => {
        const fullTask = getTaskForReminder(reminder)
        if (!fullTask) return null

        return (
          <AstridReminderPopover
            key={reminder.id}
            task={fullTask}
            currentUser={currentUser}
            onComplete={handleComplete}
            onSnooze={handleSnooze}
            onDismiss={() => handleDismiss(reminder.id)}
          />
        )
      })}
    </>
  )
}

// Hook to manually trigger a reminder for testing
export function useManualReminder() {
  return {
    triggerReminder: (task: Task, user: User) => {
      // This would be used for testing or manual triggers
      console.log('Manual reminder triggered for:', task.title)
    }
  }
}