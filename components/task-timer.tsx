"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Play, Pause, RotateCcw } from "lucide-react"
import { Task } from "@/types/task"
import { format } from "date-fns"
import { unwrapTask } from '@/lib/v1-response'

interface TaskTimerProps {
  task: Task
  onClose: () => void
  onUpdate: (task: Task) => void
}

export function TaskTimer({ task, onClose, onUpdate }: TaskTimerProps) {
  const [duration, setDuration] = useState<number>(task.timerDuration || 25)
  const [timeLeft, setTimeLeft] = useState<number>((task.timerDuration || 25) * 60)
  const [isActive, setIsActive] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  const handleComplete = useCallback(async (overriddenDuration?: number) => {
    const finalDuration = overriddenDuration ?? duration
    const completedTime = finalDuration
    const dateStr = format(new Date(), "yyyy-MM-dd")
    const commentContent = `Completed ${completedTime} minutes on ${dateStr}`

    setTimeLeft(finalDuration * 60)
    setIsActive(false)
    localStorage.removeItem(`astrid-timer-${task.id}`)

    try {
      // Add comment
      await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentContent }),
      })

      // Update task timerDuration and lastTimerValue
      const response = await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...task,
          timerDuration: finalDuration,
          lastTimerValue: commentContent
        }),
      })
      if (response.ok) {
        // v1 wraps the task in { task, meta }; onUpdate needs the task itself.
        const updatedTask = unwrapTask<Task>(await response.json())
        if (updatedTask) onUpdate(updatedTask)
      }

      alert("Timer completed!")
    } catch (error) {
      console.error("Error completing timer:", error)
    }
  }, [duration, task, onUpdate])

  // Load state from localStorage
  useEffect(() => {
    const savedState = localStorage.getItem(`astrid-timer-${task.id}`)
    if (savedState) {
      try {
        const { timeLeft: savedTimeLeft, isActive: savedIsActive, duration: savedDuration, lastUpdated } = JSON.parse(savedState)
        
        setDuration(savedDuration)
        
        if (savedIsActive) {
          const elapsedSeconds = Math.floor((Date.now() - lastUpdated) / 1000)
          const newTimeLeft = Math.max(0, savedTimeLeft - elapsedSeconds)
          setTimeLeft(newTimeLeft)
          setIsActive(newTimeLeft > 0)
          
          if (newTimeLeft === 0) {
            handleComplete(savedDuration)
          }
        } else {
          setTimeLeft(savedTimeLeft)
          setIsActive(false)
        }
      } catch (e) {
        console.error("Error parsing saved timer state", e)
      }
    }
    setIsLoaded(true)
  }, [task.id, handleComplete])

  // Save state to localStorage
  useEffect(() => {
    if (!isLoaded) return

    const state = {
      timeLeft,
      isActive,
      duration,
      lastUpdated: Date.now()
    }
    localStorage.setItem(`astrid-timer-${task.id}`, JSON.stringify(state))
  }, [timeLeft, isActive, duration, task.id, isLoaded])

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null

    if (isActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1)
      }, 1000)
    } else if (timeLeft === 0 && isActive) {
      setIsActive(false)
      handleComplete()
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isActive, timeLeft, handleComplete])

  const toggleStart = () => {
    setIsActive(!isActive)
    setIsEditing(false)
  }

  const resetTimer = () => {
    setIsActive(false)
    setTimeLeft(duration * 60)
    setIsEditing(false)
  }

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value)
    if (!isNaN(val) && val > 0) {
      setDuration(val)
      setTimeLeft(val * 60)
    }
  }

  const saveDuration = useCallback(async (newDuration: number) => {
    // Only save if duration actually changed from what's in the task
    if (newDuration === task.timerDuration) return

    try {
      const response = await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timerDuration: newDuration,
        }),
      })
      if (response.ok) {
        // v1 wraps the task in { task, meta }; onUpdate needs the task itself.
        const updatedTask = unwrapTask<Task>(await response.json())
        if (updatedTask) onUpdate(updatedTask)
      }
    } catch (error) {
      console.error("Error saving timer duration:", error)
    }
  }, [task.id, task.timerDuration, onUpdate])

  const handleDurationEditComplete = () => {
    setIsEditing(false)
    saveDuration(duration)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center text-white p-6">
      <button
        onClick={onClose}
        className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors"
      >
        <X className="w-8 h-8" />
      </button>

      <div className="w-full max-w-md flex flex-col items-center gap-12">
        <h2 className="text-2xl font-medium text-white/70 text-center px-4">
          {task.title}
        </h2>

        <div 
          className="text-8xl font-bold tabular-nums cursor-pointer"
          onClick={() => !isActive && setIsEditing(true)}
        >
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={duration}
                onChange={handleDurationChange}
                onBlur={handleDurationEditComplete}
                onKeyDown={(e) => e.key === "Enter" && handleDurationEditComplete()}
                className="bg-transparent border-none text-8xl font-bold w-48 text-center focus-visible:ring-0 p-0 h-auto"
                autoFocus
              />
              <span className="text-4xl text-white/50">min</span>
            </div>
          ) : (
            formatTime(timeLeft)
          )}
        </div>

        <div className="flex items-center gap-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={resetTimer}
            className="w-16 h-16 rounded-full bg-white/10 hover:bg-white/20 text-white"
          >
            <RotateCcw className="w-8 h-8" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleStart}
            className="w-24 h-24 rounded-full bg-white text-black hover:bg-white/90"
          >
            {isActive ? (
              <Pause className="w-12 h-12 fill-current" />
            ) : (
              <Play className="w-12 h-12 fill-current ml-1" />
            )}
          </Button>

          <div className="w-16" /> {/* Spacer for symmetry */}
        </div>

        {!isActive && !isEditing && (
          <p className="text-white/50 text-sm">
            Tap the time to change duration
          </p>
        )}
      </div>
    </div>
  )
}
