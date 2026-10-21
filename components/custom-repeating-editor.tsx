import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarIcon, X, Check } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { LAST_WEEK_OF_MONTH } from '@/types/repeating'
import type { 
  CustomRepeatingPattern,
  DailyRepeatingPattern,
  WeeklyRepeatingPattern,
  MonthlyRepeatingPattern,
  YearlyRepeatingPattern,
  RepeatingUnit, 
  Weekday, 
  MonthRepeatType, 
  RepeatEndCondition 
} from '@/types/repeating'

interface CustomRepeatingEditorProps {
  value?: CustomRepeatingPattern
  onChange: (pattern: CustomRepeatingPattern | undefined) => void
  onCancel: () => void
}

const WEEKDAYS: { value: Weekday; label: string; short: string }[] = [
  { value: 'monday', label: 'Monday', short: 'M' },
  { value: 'tuesday', label: 'Tuesday', short: 'T' },
  { value: 'wednesday', label: 'Wednesday', short: 'W' },
  { value: 'thursday', label: 'Thursday', short: 'T' },
  { value: 'friday', label: 'Friday', short: 'F' },
  { value: 'saturday', label: 'Saturday', short: 'S' },
  { value: 'sunday', label: 'Sunday', short: 'S' },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export function CustomRepeatingEditor({ value, onChange, onCancel }: CustomRepeatingEditorProps) {
  const [pattern, setPattern] = useState<CustomRepeatingPattern>(() => {
    if (value) return value
    return {
      type: 'custom',
      unit: 'days',
      interval: 1,
      endCondition: 'never'
    }
  })

  const [showEndDatePicker, setShowEndDatePicker] = useState(false)

  useEffect(() => {
    onChange(pattern)
  }, [pattern, onChange])

  const updatePattern = (updates: Partial<CustomRepeatingPattern>) => {
    setPattern(prev => ({ ...prev, ...updates } as CustomRepeatingPattern))
  }

  const handleUnitChange = (unit: RepeatingUnit) => {
    const basePattern = {
      type: 'custom' as const,
      unit,
      interval: pattern.interval,
      endCondition: pattern.endCondition,
      endAfterOccurrences: pattern.endAfterOccurrences,
      endUntilDate: pattern.endUntilDate
    }
    
    // Create unit-specific pattern
    switch (unit) {
      case 'days':
        setPattern({
          ...basePattern,
          unit: 'days'
        } as DailyRepeatingPattern)
        break
      case 'weeks':
        setPattern({
          ...basePattern,
          unit: 'weeks',
          weekdays: ['monday']
        } as WeeklyRepeatingPattern)
        break
      case 'months':
        setPattern({
          ...basePattern,
          unit: 'months',
          monthRepeatType: 'same_date',
          monthDay: 1
        } as MonthlyRepeatingPattern)
        break
      case 'years':
        setPattern({
          ...basePattern,
          unit: 'years',
          month: 1,
          day: 1
        } as YearlyRepeatingPattern)
        break
    }
  }

  const handleWeekdayToggle = (weekday: Weekday) => {
    if (pattern.unit !== 'weeks') return
    
    const currentWeekdays = pattern.weekdays || []
    const newWeekdays = currentWeekdays.includes(weekday)
      ? currentWeekdays.filter(w => w !== weekday)
      : [...currentWeekdays, weekday]
    
    if (newWeekdays.length > 0) {
      updatePattern({ weekdays: newWeekdays })
    }
  }

  const handleMonthRepeatTypeChange = (type: MonthRepeatType) => {
    if (pattern.unit !== 'months') return
    
    if (type === 'same_date') {
      updatePattern({ monthRepeatType: type, monthDay: 1 })
    } else {
      updatePattern({ 
        monthRepeatType: type, 
        monthWeekday: { weekday: 'monday', weekOfMonth: 1 } 
      })
    }
  }

  const handleSave = () => {
    onChange(pattern)
  }



    return (
    <div className="space-y-4 p-4 theme-surface-secondary rounded-lg border theme-border">
      {/* Basic Settings */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="theme-text-muted">Repeat every</Label>
          <div className="flex items-center space-x-2 mt-1">
            <Input
              type="number"
              min="1"
              value={pattern.interval}
              onChange={(e) => updatePattern({ interval: parseInt(e.target.value) || 1 })}
              className="w-20 theme-input"
            />
            <Select value={pattern.unit} onValueChange={handleUnitChange}>
              <SelectTrigger className="theme-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="days">Days</SelectItem>
                <SelectItem value="weeks">Weeks</SelectItem>
                <SelectItem value="months">Months</SelectItem>
                <SelectItem value="years">Years</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Week-specific settings */}
      {pattern.unit === 'weeks' && (
        <div>
          <Label className="theme-text-muted">Repeat on these days</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {WEEKDAYS.map(({ value, label, short }) => (
              <div key={value} className="flex items-center space-x-2">
                <Checkbox
                  id={value}
                  checked={pattern.weekdays?.includes(value) || false}
                  onCheckedChange={() => handleWeekdayToggle(value)}
                  className="theme-border"
                />
                <Label htmlFor={value} className="text-sm theme-text-muted cursor-pointer">
                  {short}
                </Label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Month-specific settings */}
      {pattern.unit === 'months' && (
        <div className="space-y-3">
          <div>
            <Label className="theme-text-muted">Repeat type</Label>
            <Select
              value={pattern.monthRepeatType}
              onValueChange={handleMonthRepeatTypeChange}
            >
              <SelectTrigger className="theme-input mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same_date">Same date every month</SelectItem>
                <SelectItem value="same_weekday">Same weekday and week of month</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {pattern.monthRepeatType === 'same_date' && (
            <div>
              <Label className="theme-text-muted">Day of month</Label>
              <Input
                type="number"
                min="1"
                max="31"
                value={pattern.monthDay || 1}
                onChange={(e) => updatePattern({ monthDay: parseInt(e.target.value) || 1 })}
                className="w-20 theme-input mt-1"
              />
            </div>
          )}

          {pattern.monthRepeatType === 'same_weekday' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="theme-text-muted">Weekday</Label>
                <Select
                  value={pattern.monthWeekday?.weekday || 'monday'}
                  onValueChange={(weekday: Weekday) => updatePattern({
                    monthWeekday: {
                      ...pattern.monthWeekday!,
                      weekday
                    }
                  })}
                >
                  <SelectTrigger className="theme-input mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="theme-text-muted">Week of month</Label>
                <Select
                  value={String(pattern.monthWeekday?.weekOfMonth || 1)}
                  onValueChange={(week) => updatePattern({
                    monthWeekday: {
                      ...pattern.monthWeekday!,
                      weekOfMonth: parseInt(week)
                    }
                  })}
                >
                  <SelectTrigger className="theme-input mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1st</SelectItem>
                    <SelectItem value="2">2nd</SelectItem>
                    <SelectItem value="3">3rd</SelectItem>
                    <SelectItem value="4">4th</SelectItem>
                    <SelectItem value="5">5th</SelectItem>
                    <SelectItem value={String(LAST_WEEK_OF_MONTH)}>Last</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Year-specific settings */}
      {pattern.unit === 'years' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="theme-text-muted">Month</Label>
            <Select
              value={String(pattern.month || 1)}
              onValueChange={(month) => updatePattern({ month: parseInt(month) })}
            >
              <SelectTrigger className="theme-input mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((month, index) => (
                  <SelectItem key={index + 1} value={String(index + 1)}>{month}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="theme-text-muted">Day</Label>
            <Input
              type="number"
              min="1"
              max="31"
              value={pattern.day || 1}
              onChange={(e) => updatePattern({ day: parseInt(e.target.value) || 1 })}
              className="w-20 theme-input mt-1"
            />
          </div>
        </div>
      )}

      {/* End conditions */}
      <div>
        <Label className="theme-text-muted">End condition</Label>
        <Select
          value={pattern.endCondition}
          onValueChange={(endCondition: RepeatEndCondition) => updatePattern({ endCondition })}
        >
          <SelectTrigger className="theme-input mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="never">Never</SelectItem>
            <SelectItem value="after_occurrences">After X occurrences</SelectItem>
            <SelectItem value="until_date">Until specific date</SelectItem>
          </SelectContent>
        </Select>

        {pattern.endCondition === 'after_occurrences' && (
          <div className="mt-2">
            <Label className="theme-text-muted">Number of occurrences</Label>
            <Input
              type="number"
              min="1"
              value={pattern.endAfterOccurrences || 1}
              onChange={(e) => updatePattern({ endAfterOccurrences: parseInt(e.target.value) || 1 })}
              className="w-20 theme-input mt-1"
            />
          </div>
        )}

        {pattern.endCondition === 'until_date' && (
          <div className="mt-2">
            <Label className="theme-text-muted">End date</Label>
            <Popover open={showEndDatePicker} onOpenChange={setShowEndDatePicker}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal theme-input",
                    !pattern.endUntilDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {pattern.endUntilDate ? format(pattern.endUntilDate, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 theme-surface border theme-border">
                <Calendar
                  mode="single"
                  selected={pattern.endUntilDate}
                  onSelect={(date) => {
                    updatePattern({ endUntilDate: date })
                    setShowEndDatePicker(false)
                  }}
                  initialFocus
                  className="theme-surface theme-text"
                />
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </div>
  )
}

function getPatternSummary(pattern: CustomRepeatingPattern): string {
  const { unit, interval } = pattern
  
  let summary = `Every ${interval} ${unit}`
  
  switch (unit) {
    case 'weeks':
      if (pattern.weekdays?.length) {
        summary += ` on ${pattern.weekdays.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(', ')}`
      }
      break
      
    case 'months':
      if (pattern.monthRepeatType === 'same_date' && pattern.monthDay) {
        summary += ` on the ${pattern.monthDay}${getOrdinalSuffix(pattern.monthDay)}`
      } else if (pattern.monthRepeatType === 'same_weekday' && pattern.monthWeekday) {
        const { weekday, weekOfMonth } = pattern.monthWeekday
        const week = weekOfMonth === LAST_WEEK_OF_MONTH ? 'last' : `${weekOfMonth}${getOrdinalSuffix(weekOfMonth)}`
        summary += ` on the ${week} ${weekday.charAt(0).toUpperCase() + weekday.slice(1)}`
      }
      break
      
    case 'years':
      if (pattern.month && pattern.day) {
        const monthName = MONTHS[pattern.month - 1]
        summary += ` on ${monthName} ${pattern.day}${getOrdinalSuffix(pattern.day)}`
      }
      break
  }
  
  if (pattern.endCondition === 'after_occurrences' && pattern.endAfterOccurrences) {
    summary += ` (${pattern.endAfterOccurrences} times)`
  } else if (pattern.endCondition === 'until_date' && pattern.endUntilDate) {
    summary += ` until ${format(pattern.endUntilDate, "PPP")}`
  }
  
  return summary
}

function getOrdinalSuffix(num: number): string {
  if (num >= 11 && num <= 13) return 'th'
  switch (num % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}
