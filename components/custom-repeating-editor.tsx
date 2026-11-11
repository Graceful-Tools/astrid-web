import React, { useState, useEffect, useId } from 'react'
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
import { useTranslations } from '@/lib/i18n/client'
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

// `short` is the English fallback; the editor shows the locale's own narrow name.
const WEEKDAYS: { value: Weekday; labelKey: string; short: string }[] = [
  { value: 'monday', labelKey: 'weekdays.monday', short: 'M' },
  { value: 'tuesday', labelKey: 'weekdays.tuesday', short: 'T' },
  { value: 'wednesday', labelKey: 'weekdays.wednesday', short: 'W' },
  { value: 'thursday', labelKey: 'weekdays.thursday', short: 'T' },
  { value: 'friday', labelKey: 'weekdays.friday', short: 'F' },
  { value: 'saturday', labelKey: 'weekdays.saturday', short: 'S' },
  { value: 'sunday', labelKey: 'weekdays.sunday', short: 'S' },
]

/** One-letter weekday names for a locale, Monday first (1 Jan 2024 was a Monday). */
function narrowWeekdays(locale: string | undefined): string[] {
  try {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
    return WEEKDAYS.map((_, index) => formatter.format(new Date(2024, 0, 1 + index)))
  } catch {
    return WEEKDAYS.map(({ short }) => short)
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const MONTH_KEYS = MONTHS.map(month => `months.${month.toLowerCase()}`)

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
  const fieldId = useId()
  const { t, locale } = useTranslations()
  const shortWeekdays = narrowWeekdays(locale)

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
    
    // An empty set is allowed WHILE editing, so the only day can be swapped
    // for another; isCustomPatternSavable keeps it from being saved (AWTD-1352).
    const currentWeekdays = pattern.weekdays || []
    const newWeekdays = currentWeekdays.includes(weekday)
      ? currentWeekdays.filter(w => w !== weekday)
      : [...currentWeekdays, weekday]

    updatePattern({ weekdays: newWeekdays })
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
          <Label htmlFor={`${fieldId}-interval`} className="theme-text-muted">{t('repeating.editor.repeatEvery')}</Label>
          <div className="flex items-center space-x-2 mt-1">
            <NumberField
              id={`${fieldId}-interval`}
              value={pattern.interval}
              onCommit={(interval) => updatePattern({ interval })}
              className="w-20 theme-input"
            />
            <Select value={pattern.unit} onValueChange={handleUnitChange}>
              <SelectTrigger className="theme-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="days">{t('repeating.editor.unitDays')}</SelectItem>
                <SelectItem value="weeks">{t('repeating.editor.unitWeeks')}</SelectItem>
                <SelectItem value="months">{t('repeating.editor.unitMonths')}</SelectItem>
                <SelectItem value="years">{t('repeating.editor.unitYears')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Week-specific settings */}
      {pattern.unit === 'weeks' && (
        <div>
          <Label className="theme-text-muted">{t('repeating.editor.repeatOnDays')}</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {WEEKDAYS.map(({ value, labelKey }, index) => (
              <div key={value} className="flex items-center space-x-2">
                <Checkbox
                  id={`${fieldId}-${value}`}
                  aria-label={t(labelKey)}
                  checked={pattern.weekdays?.includes(value) || false}
                  onCheckedChange={() => handleWeekdayToggle(value)}
                  className="theme-border"
                />
                <Label htmlFor={`${fieldId}-${value}`} className="text-sm theme-text-muted cursor-pointer">
                  {shortWeekdays[index]}
                </Label>
              </div>
            ))}
          </div>
          {(pattern.weekdays?.length ?? 0) === 0 && (
            <p className="text-xs theme-text-muted mt-1" role="status">
              {t('repeating.pickAtLeastOneDay')}
            </p>
          )}
        </div>
      )}

      {/* Month-specific settings */}
      {pattern.unit === 'months' && (
        <div className="space-y-3">
          <div>
            <Label className="theme-text-muted">{t('repeating.editor.repeatType')}</Label>
            <Select
              value={pattern.monthRepeatType}
              onValueChange={handleMonthRepeatTypeChange}
            >
              <SelectTrigger className="theme-input mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same_date">{t('repeating.editor.sameDate')}</SelectItem>
                <SelectItem value="same_weekday">{t('repeating.editor.sameWeekday')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {pattern.monthRepeatType === 'same_date' && (
            <div>
              <Label className="theme-text-muted">{t('repeating.editor.dayOfMonth')}</Label>
              <NumberField
                max={31}
                value={pattern.monthDay || 1}
                onCommit={(monthDay) => updatePattern({ monthDay })}
                className="w-20 theme-input mt-1"
              />
            </div>
          )}

          {pattern.monthRepeatType === 'same_weekday' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="theme-text-muted">{t('repeating.editor.weekday')}</Label>
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
                    {WEEKDAYS.map(({ value, labelKey }) => (
                      <SelectItem key={value} value={value}>{t(labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="theme-text-muted">{t('repeating.editor.weekOfMonth')}</Label>
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
                    <SelectItem value="1">{t('repeating.editor.week1')}</SelectItem>
                    <SelectItem value="2">{t('repeating.editor.week2')}</SelectItem>
                    <SelectItem value="3">{t('repeating.editor.week3')}</SelectItem>
                    <SelectItem value="4">{t('repeating.editor.week4')}</SelectItem>
                    <SelectItem value="5">{t('repeating.editor.week5')}</SelectItem>
                    <SelectItem value={String(LAST_WEEK_OF_MONTH)}>{t('repeating.editor.weekLast')}</SelectItem>
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
            <Label className="theme-text-muted">{t('repeating.editor.month')}</Label>
            <Select
              value={String(pattern.month || 1)}
              onValueChange={(month) => updatePattern({ month: parseInt(month) })}
            >
              <SelectTrigger className="theme-input mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_KEYS.map((monthKey, index) => (
                  <SelectItem key={index + 1} value={String(index + 1)}>{t(monthKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="theme-text-muted">{t('repeating.editor.day')}</Label>
            <NumberField
              max={31}
              value={pattern.day || 1}
              onCommit={(day) => updatePattern({ day })}
              className="w-20 theme-input mt-1"
            />
          </div>
        </div>
      )}

      {/* End conditions */}
      <div>
        <Label className="theme-text-muted">{t('repeating.editor.endCondition')}</Label>
        <Select
          value={pattern.endCondition}
          onValueChange={(endCondition: RepeatEndCondition) => updatePattern({ endCondition })}
        >
          <SelectTrigger className="theme-input mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="never">{t('repeating.editor.never')}</SelectItem>
            <SelectItem value="after_occurrences">{t('repeating.editor.afterOccurrences')}</SelectItem>
            <SelectItem value="until_date">{t('repeating.editor.untilDate')}</SelectItem>
          </SelectContent>
        </Select>

        {pattern.endCondition === 'after_occurrences' && (
          <div className="mt-2">
            <Label className="theme-text-muted">{t('repeating.editor.occurrencesCount')}</Label>
            <NumberField
              value={pattern.endAfterOccurrences || 1}
              onCommit={(endAfterOccurrences) => updatePattern({ endAfterOccurrences })}
              className="w-20 theme-input mt-1"
            />
          </div>
        )}

        {pattern.endCondition === 'until_date' && (
          <div className="mt-2">
            <Label className="theme-text-muted">{t('repeating.editor.endDate')}</Label>
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
                  {pattern.endUntilDate ? format(pattern.endUntilDate, "PPP") : t('time.pickDate')}
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
                  autoFocus
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

/**
 * Whether a pattern is complete enough to save. The editor lets a weekly
 * pattern's days go empty mid-edit (AWTD-1352), so the Save button asks this
 * rather than the editor refusing the edit.
 */
export function isCustomPatternSavable(pattern: CustomRepeatingPattern | undefined | null): boolean {
  if (!pattern) return false
  if (pattern.unit === 'weeks') return (pattern.weekdays?.length ?? 0) > 0
  return true
}

/**
 * A positive-integer input that keeps what the user typed — including an empty
 * field — and only falls back to the last good value when it loses focus.
 * Clamping on every keystroke turned a cleared "4" into "1", so retyping gave
 * "14" (AWTD-1352).
 */
function NumberField({
  value,
  onCommit,
  max,
  id,
  className,
}: {
  value: number
  onCommit: (value: number) => void
  max?: number
  id?: string
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(prev => (parseInt(prev, 10) === value ? prev : String(value)))
  }, [value])

  const parse = (text: string): number | null => {
    const n = parseInt(text, 10)
    if (!Number.isFinite(n) || n < 1) return null
    return max !== undefined ? Math.min(n, max) : n
  }

  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min="1"
      max={max}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = parse(e.target.value)
        if (n !== null) onCommit(n)
      }}
      onBlur={() => {
        const n = parse(draft) ?? value
        setDraft(String(n))
        if (n !== value) onCommit(n)
      }}
      className={className}
    />
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
