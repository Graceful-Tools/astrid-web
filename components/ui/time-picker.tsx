"use client"

import { useState, useEffect } from "react"
import { Button } from "./button"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { Clock } from "lucide-react"
import { isMobileDevice } from "@/lib/layout-detection"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

interface TimePickerProps {
  value?: Date | string | null
  onChange: (time: Date | string | null) => void
  placeholder?: string
  className?: string
  showAllDayOption?: boolean
  compact?: boolean
  mode?: "date" | "string" // "date" returns Date objects, "string" returns HH:MM format
  label?: string
  popoverClassName?: string // Additional className for the PopoverContent (e.g., for z-index overrides)
}

// Generate 5-minute increment options
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5)

// Generate hour options (1-12)
const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

export function TimePicker({
  value,
  onChange,
  placeholder = "Select time",
  className = "",
  showAllDayOption = true,
  compact = false,
  mode = "date",
  label,
  popoverClassName = "",
}: TimePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [hours, setHours] = useState<number>(5)
  const [minutes, setMinutes] = useState<number>(0)
  const [period, setPeriod] = useState<"AM" | "PM">("PM")
  const [hasChanges, setHasChanges] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    setIsMobile(isMobileDevice())
  }, [])

  // Quick time options
  const quickTimes = [
    { label: "9am", hours: 9, minutes: 0, period: "AM" as const },
    { label: "Noon", hours: 12, minutes: 0, period: "PM" as const },
    { label: "5pm", hours: 5, minutes: 0, period: "PM" as const },
  ]

  // Initialize from value prop
  useEffect(() => {
    if (value) {
      let date: Date

      if (typeof value === "string") {
        // Two string formats are passed in: bare "HH:MM" (reminder settings)
        // and full ISO timestamps "YYYY-MM-DDTHH:MM:SS.sssZ" (task fields,
        // which round-trip as strings through IndexedDB cache hydration).
        // The split-on-colon parser produces nonsense for ISO strings —
        // parseInt("2025-04-29T22") returns 2025, then setHours(2025)
        // overflows and the picker lands on ~9am. Detect ISO and use Date.
        const looksLikeIso = value.length > 5 && (value.includes("T") || value.includes("-"))
        if (looksLikeIso) {
          date = new Date(value)
        } else {
          const [hourStr, minuteStr] = value.split(':')
          const hour24 = parseInt(hourStr)
          const mins = parseInt(minuteStr)
          date = new Date()
          date.setHours(hour24, mins, 0, 0)
        }
      } else {
        // Handle Date object
        date = new Date(value)
      }
      
      let hour12 = date.getHours()
      const mins = date.getMinutes()
      const ampm = hour12 >= 12 ? "PM" : "AM"
      
      // Convert to 12-hour format
      if (hour12 === 0) hour12 = 12
      else if (hour12 > 12) hour12 = hour12 - 12

      setHours(hour12)
      // Round to nearest 5-minute increment
      setMinutes(Math.round(mins / 5) * 5)
      setPeriod(ampm)
    } else {
      // Default to 5pm if no value
      setHours(5)
      setMinutes(0)
      setPeriod("PM")
    }
    setHasChanges(false) // Reset changes when value changes
  }, [value])

  // Reset changes when popover opens
  useEffect(() => {
    if (isOpen) {
      setHasChanges(false)
    }
  }, [isOpen])

  // Update internal state only (don't trigger onChange)
  const updateTimeSelection = (newHours?: number, newMinutes?: number, newPeriod?: "AM" | "PM") => {
    if (newHours !== undefined) setHours(newHours)
    if (newMinutes !== undefined) setMinutes(newMinutes)
    if (newPeriod !== undefined) setPeriod(newPeriod)
    setHasChanges(true) // Mark that user has made changes
  }

  // Apply the time change and trigger onChange
  const handleTimeConfirm = (newHours?: number, newMinutes?: number, newPeriod?: "AM" | "PM") => {
    const finalHours = newHours !== undefined ? newHours : hours
    const finalMinutes = newMinutes !== undefined ? newMinutes : minutes
    const finalPeriod = newPeriod !== undefined ? newPeriod : period

    setHours(finalHours)
    setMinutes(finalMinutes)
    setPeriod(finalPeriod)

    // Convert to 24-hour format
    const hour24 = finalPeriod === "AM" 
      ? (finalHours === 12 ? 0 : finalHours)
      : (finalHours === 12 ? 12 : finalHours + 12)

    if (mode === "string") {
      // Return HH:MM string format
      const timeString = `${hour24.toString().padStart(2, "0")}:${finalMinutes.toString().padStart(2, "0")}`
      onChange(timeString)
    } else {
      // Return Date object
      const now = new Date()
      const newTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour24, finalMinutes)
      onChange(newTime)
    }
  }

  const handleClear = () => {
    onChange(null)
    setIsOpen(false)
  }

  const handleQuickTime = (quickTime: typeof quickTimes[0]) => {
    handleTimeConfirm(quickTime.hours, quickTime.minutes, quickTime.period)
    setHasChanges(false)
    setIsOpen(false)
  }

  const handleSetTime = () => {
    handleTimeConfirm()
    setHasChanges(false)
    setIsOpen(false)
  }

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const timeVal = e.target.value // HH:mm
    if (!timeVal) {
      onChange(null)
      return
    }
    
    const [h, m] = timeVal.split(':').map(Number)
    
    // Convert to 12-hour format for internal state
    let h12 = h
    const p = h >= 12 ? "PM" : "AM"
    if (h12 === 0) h12 = 12
    else if (h12 > 12) h12 = h12 - 12
    
    setHours(h12)
    setMinutes(m)
    setPeriod(p)
    
    // Trigger onChange
    if (mode === "string") {
      onChange(timeVal)
    } else {
      const now = new Date()
      const newTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
      onChange(newTime)
    }
  }

  const formatDisplayTime = (h: number, m: number, p: "AM" | "PM"): string => {
    const hourStr = h.toString()
    const minuteStr = m === 0 ? "" : `:${m.toString().padStart(2, "0")}`
    const periodStr = p.toLowerCase()
    return `${hourStr}${minuteStr}${periodStr}`
  }

  const displayValue = value 
    ? formatDisplayTime(hours, minutes, period)
    : placeholder

  if (isMobile) {
    // Format value for native input (`<input type="time">` only accepts
    // "HH:mm"). Strings can arrive as either bare HH:mm (reminder settings)
    // or full ISO timestamps (task fields hydrated from cache). Passing an
    // ISO string makes the input silently reject the value, leaving it
    // empty — on iOS the native picker then commits the default time on
    // any tap, producing the "auto-selects and closes" symptom.
    let nativeValue = ""
    if (value) {
      if (typeof value === "string") {
        const looksLikeIso = value.length > 5 && (value.includes("T") || value.includes("-"))
        nativeValue = looksLikeIso ? format(new Date(value), "HH:mm") : value
      } else {
        nativeValue = format(new Date(value), "HH:mm")
      }
    }

    return (
      <div className={cn("relative", className)}>
        {label && <label className="text-sm text-muted-foreground mb-1 block">{label}</label>}
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal w-full",
            compact ? "h-8 px-2 text-sm" : "h-9 px-3",
            !value && "text-muted-foreground"
          )}
        >
          <Clock className="mr-2 h-4 w-4" />
          {displayValue}
        </Button>
        <input
          type="time"
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          onChange={handleNativeChange}
          value={nativeValue}
        />
      </div>
    )
  }

  return (
    <div className={className}>
      {label && <label className="text-sm text-muted-foreground mb-1 block">{label}</label>}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={`justify-start text-left font-normal ${
              compact 
                ? "h-8 px-2 text-sm" 
                : "h-9 px-3"
            } ${!value && "text-muted-foreground"} ${
              mode === "string" ? "w-auto min-w-[120px]" : ""
            }`}
          >
            <Clock className="mr-2 h-4 w-4" />
            {displayValue}
          </Button>
        </PopoverTrigger>
        <PopoverContent className={`!w-auto p-0 ${popoverClassName}`} align="start">
          <style>{`
            .time-picker-scroll::-webkit-scrollbar {
              display: none;
            }
            .time-picker-scroll {
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
          `}</style>
          <div className="flex">
            {/* Hours */}
            <div className="border-r w-12">
              <div className="h-32 overflow-y-auto time-picker-scroll">
                <div className="px-2 py-1">
                  {HOUR_OPTIONS.map((hour) => (
                    <button
                      key={hour}
                      onClick={() => updateTimeSelection(hour, undefined, undefined)}
                      className={`w-full text-sm hover:bg-accent hover:text-accent-foreground rounded px-1 py-0.5 min-h-6 ${
                        hours === hour ? "bg-accent text-accent-foreground" : ""
                      }`}
                    >
                      {hour}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Minutes */}
            <div className="border-r w-12">
              <div className="h-32 overflow-y-auto time-picker-scroll">
                <div className="px-2 py-1">
                  {MINUTE_OPTIONS.map((minute) => (
                    <button
                      key={minute}
                      onClick={() => updateTimeSelection(undefined, minute, undefined)}
                      className={`w-full text-sm hover:bg-accent hover:text-accent-foreground rounded px-1 py-0.5 min-h-6 ${
                        minutes === minute ? "bg-accent text-accent-foreground" : ""
                      }`}
                    >
                      {minute.toString().padStart(2, "0")}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* AM/PM */}
            <div className="w-10">
              <div className="p-1">
                {["AM", "PM"].map((p) => (
                  <button
                    key={p}
                    onClick={() => updateTimeSelection(undefined, undefined, p as "AM" | "PM")}
                    className={`w-full text-sm hover:bg-accent hover:text-accent-foreground rounded px-1 py-0.5 min-h-6 mb-0.5 ${
                      period === p ? "bg-accent text-accent-foreground" : ""
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Set Time button and Quick time buttons */}
          <div className="border-t p-2">
            {/* Set Time button */}
            <Button
              onClick={handleSetTime}
              variant={hasChanges ? "default" : "outline"}
              className={`w-full mb-3 text-sm transition-all ${
                hasChanges 
                  ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
              size="sm"
            >
              {hasChanges ? "Set Time" : "Set Time"}
            </Button>

            <div className="text-xs text-muted-foreground mb-2">Quick select:</div>
            <div className="flex space-x-1 mb-2">
              {quickTimes.map((quickTime) => (
                <Button
                  key={quickTime.label}
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickTime(quickTime)}
                  className="text-xs px-2 py-1 h-auto"
                >
                  {quickTime.label}
                </Button>
              ))}
            </div>

            {/* All Day button */}
            {showAllDayOption && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className="w-full text-xs"
              >
                All Day
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// Helper function to convert HH:MM string to Date object for today
export function timeStringToDate(timeString: string | null | undefined): Date | null {
  if (!timeString) return null
  
  const [hours, minutes] = timeString.split(':').map(Number)
  if (isNaN(hours) || isNaN(minutes)) return null
  
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes)
}

// Helper function to convert Date object to HH:MM string
export function dateToTimeString(date: Date | null | undefined): string | null {
  if (!date) return null
  
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

// Helper function to format time in concise format (10am, 9pm, 9:30pm)
export function formatConciseTime(date: Date | null | undefined): string | null {
  if (!date) return null
  
  const hours = date.getHours()
  const minutes = date.getMinutes()
  
  let hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  const period = hours >= 12 ? "pm" : "am"
  const minuteStr = minutes === 0 ? "" : `:${minutes.toString().padStart(2, "0")}`
  
  return `${hour12}${minuteStr}${period}`
}