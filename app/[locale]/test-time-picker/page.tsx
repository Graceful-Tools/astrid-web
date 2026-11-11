"use client"

import { useState } from "react"
import { TimePicker, formatConciseTime } from "@/components/ui/time-picker"

export default function TestTimePickerPage() {
  const [time1, setTime1] = useState<Date | null>(null)
  const [time2, setTime2] = useState<Date | null>(null)

  const handleTime1Change = (time: Date | string | null) => {
    if (time instanceof Date) {
      setTime1(time)
    } else {
      setTime1(null)
    }
  }

  const handleTime2Change = (time: Date | string | null) => {
    if (time instanceof Date) {
      setTime2(time)
    } else {
      setTime2(null)
    }
  }

  return (
    <div className="container mx-auto p-8 space-y-8">
      <h1 className="text-3xl font-bold mb-8">New Time Picker Demo</h1>
      
      {/* Full Time Picker */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Full Time Picker</h2>
        <TimePicker 
          value={time1}
          onChange={handleTime1Change}
          placeholder="Select time"
        />
        {time1 && (
          <div className="space-y-2 text-sm text-theme-muted">
            <p>Selected: {time1.toLocaleTimeString()}</p>
            <p>Concise format: {formatConciseTime(time1)}</p>
          </div>
        )}
      </div>

      {/* Compact Time Picker */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Compact Time Picker</h2>
        <TimePicker 
          value={time2}
          onChange={handleTime2Change}
          compact={true}
          placeholder="Select time"
        />
        {time2 && (
          <div className="space-y-2 text-sm text-theme-muted">
            <p>Selected: {time2.toLocaleTimeString()}</p>
            <p>Concise format: {formatConciseTime(time2)}</p>
          </div>
        )}
      </div>

      {/* Features */}
      <div className="mt-12 p-6 bg-theme-secondary rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Features</h2>
        <ul className="space-y-2 text-sm">
          <li>• Vertical dial interface like Google Calendar</li>
          <li>• 5-minute increments for minutes (00, 05, 10, 15, etc.)</li>
          <li>• Concise time display format (10am, 9pm, 9:30pm)</li>
          <li>• Compact mode for inline use</li>
          <li>• All day option support</li>
        </ul>
      </div>
    </div>
  )
}