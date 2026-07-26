import type { Task, TaskList } from '@/types/task'
import { parseRelativeDate } from '@/lib/date-utils'
import { applyVirtualListFilter } from '@/lib/virtual-list-utils'
import type { WeeklyRepeatingPattern, Weekday } from '@/types/repeating'
import { getNLPKeywords, type NLPKeywords } from '@/lib/i18n/nlp-keywords'
import { createLogger } from '@/lib/logger'
import { isSystemListId } from "@/lib/list-permissions"

const log = createLogger('task-manager-utils')


/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Check if a string contains CJK (Chinese, Japanese, Korean) characters
 */
function containsCJK(str: string): boolean {
  // CJK Unified Ideographs, Hiragana, Katakana, Hangul
  return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(str)
}

/**
 * Build a regex pattern from an array of keywords
 * Handles multi-word phrases by escaping and joining with |
 * Uses appropriate word boundaries for Latin vs CJK scripts
 */
function buildKeywordRegex(keywords: string[], flags: string = 'i'): RegExp {
  const escaped = keywords.map(k => escapeRegex(k))

  // Check if any keywords contain CJK characters
  const hasCJK = keywords.some(containsCJK)

  if (hasCJK) {
    // For CJK, use lookahead/lookbehind for whitespace or string boundaries
    // This matches keywords that are at start/end of string or surrounded by whitespace
    return new RegExp(`(?:^|\\s)(${escaped.join('|')})(?=\\s|$)`, flags)
  }

  // For Latin scripts, use standard word boundaries
  return new RegExp(`\\b(${escaped.join('|')})\\b`, flags)
}

/**
 * Map localized day name to English weekday for internal use
 */
function mapLocalizedDay(dayStr: string, keywords: NLPKeywords): Weekday | null {
  const lower = dayStr.toLowerCase()
  const dayMapping: Array<{ key: keyof NLPKeywords['dates']; weekday: Weekday }> = [
    { key: 'monday', weekday: 'monday' },
    { key: 'tuesday', weekday: 'tuesday' },
    { key: 'wednesday', weekday: 'wednesday' },
    { key: 'thursday', weekday: 'thursday' },
    { key: 'friday', weekday: 'friday' },
    { key: 'saturday', weekday: 'saturday' },
    { key: 'sunday', weekday: 'sunday' },
  ]

  for (const { key, weekday } of dayMapping) {
    if (keywords.dates[key].some(k => k.toLowerCase() === lower)) {
      return weekday
    }
  }
  return null
}

/**
 * Check if a list ID represents a virtual/built-in list
 */
function isVirtualListId(listId: string): boolean {
  // Single source of truth for the built-in list ids (task e2803305).
  return isSystemListId(listId)
}

/**
 * Parse task input string to extract structured task data
 * Handles patterns like:
 * - "Task today" -> extracts date
 * - "High priority task" -> extracts priority
 * - "Task assign to jon" -> extracts assignee
 * - "Task #shopping #personal" -> extracts list hashtags
 *
 * @param skipSmartParsing - If true, skip all smart parsing and return raw title
 */
export function parseTaskInput(input: string, selectedListId: string, effectiveSession?: any, lists?: TaskList[], skipSmartParsing?: boolean, locale?: string) {
  let title = input.trim()
  let dueDateTime: Date | undefined = undefined
  let priority: number = 0
  let assigneeId: string | undefined = undefined
  let extractedListIds: string[] = []

  // Get localized keywords (defaults to English)
  const keywords = getNLPKeywords(locale || 'en')

  // If smart parsing is disabled, just return the raw title with no parsing
  if (skipSmartParsing) {
    // Still need to determine the list ID
    let finalListIds: string[] = []
    if (selectedListId && !isVirtualListId(selectedListId)) {
      finalListIds.push(selectedListId)
    }

    return {
      title: title,
      dueDateTime: undefined,
      priority: undefined,
      assigneeId: undefined,
      listIds: finalListIds,
      isPrivate: undefined,
      repeating: undefined,
      customRepeatingData: null,
    }
  }

  // Parse hashtags for list assignment
  // Match hashtags like #shopping, #work&life, #mom's-tasks, etc.
  // Stops at whitespace but allows most special characters within the hashtag
  const hashtagRegex = /(?:^|\s)#([^\s]+)/g
  const hashtagMatches = Array.from(title.matchAll(hashtagRegex))

  if (hashtagMatches.length > 0 && lists && lists.length > 0) {
    // Extract hashtag names (without the # symbol)
    const hashtagNames = hashtagMatches.map(match => match[1].toLowerCase())

    // Find matching lists by name (case-insensitive, fuzzy match)
    const realLists = lists.filter(list => !list.isVirtual)
    for (const hashtagName of hashtagNames) {
      const matchingList = realLists.find(list =>
        list.name.toLowerCase().replace(/\s+/g, '-') === hashtagName ||
        list.name.toLowerCase().replace(/\s+/g, '_') === hashtagName ||
        list.name.toLowerCase().replace(/\s+/g, '') === hashtagName ||
        list.name.toLowerCase() === hashtagName
      )

      if (matchingList && !extractedListIds.includes(matchingList.id)) {
        extractedListIds.push(matchingList.id)
      }
    }

    // Remove all hashtags from title and clean up extra spaces
    title = title.replace(hashtagRegex, ' ').replace(/\s+/g, ' ').trim()
  }

  // Parse repeating patterns BEFORE date keywords
  // This allows "weekly Monday" to be parsed as "repeat weekly on Monday"
  let repeating: string | undefined = undefined
  let customRepeatingData: WeeklyRepeatingPattern | null = null

  // Build localized day keywords regex for "weekly [day]" pattern
  const allDayKeywords = [
    ...keywords.dates.monday,
    ...keywords.dates.tuesday,
    ...keywords.dates.wednesday,
    ...keywords.dates.thursday,
    ...keywords.dates.friday,
    ...keywords.dates.saturday,
    ...keywords.dates.sunday,
  ].map(escapeRegex)

  // Build weekly keywords
  const weeklyKeywords = [...keywords.repeating.weekly, ...keywords.repeating.everyWeek].map(escapeRegex)

  // Pattern: "weekly [day]" or localized equivalent - weekly repeating on specific day(s)
  // Note: separators like "and", "und", "et", "y", "e" must be whole words to avoid matching within day names
  const weeklyWithDayRegex = new RegExp(
    `\\b(?:${weeklyKeywords.join('|')})\\s+((?:${allDayKeywords.join('|')})(?:\\s+(?:and|und|et|y|e)\\s+(?:${allDayKeywords.join('|')})|\\s*,\\s*(?:${allDayKeywords.join('|')}))*)\\b`,
    'i'
  )
  const weeklyWithDayMatch = title.match(weeklyWithDayRegex)

  if (weeklyWithDayMatch) {
    // Extract weekdays from the match and map to English
    const daysString = weeklyWithDayMatch[1]
    // Split by commas or by conjunction words (and, und, et, y, e) that are surrounded by whitespace
    const dayParts = daysString.split(/\s*,\s*|\s+(?:and|und|et|y|e)\s+/i).map(d => d.trim())
    const dayNames: Weekday[] = []

    for (const dayPart of dayParts) {
      const mappedDay = mapLocalizedDay(dayPart, keywords)
      if (mappedDay) {
        dayNames.push(mappedDay)
      }
    }

    if (dayNames.length > 0) {
      // Set up custom weekly repeating pattern
      repeating = 'custom'
      customRepeatingData = {
        type: 'custom',
        unit: 'weeks',
        interval: 1,
        weekdays: dayNames,
        endCondition: 'never'
      }

      // Set due date to next occurrence of first day
      const firstDay = dayNames[0]
      dueDateTime = parseRelativeDate(firstDay) || undefined

      // Remove the entire "weekly [day]" phrase from title
      title = title.replace(weeklyWithDayMatch[0], '').replace(/\s+/g, ' ').trim()
    }
  }

  // Pattern: Simple repeating keywords (daily, weekly, monthly, yearly)
  // Only parse if we haven't already matched a more specific pattern above
  if (!repeating) {
    // Build regex for all simple repeating keywords
    const dailyKeywords = [...keywords.repeating.daily, ...keywords.repeating.everyDay]
    const monthlyKeywords = [...keywords.repeating.monthly, ...keywords.repeating.everyMonth]
    const yearlyKeywords = [...keywords.repeating.yearly, ...keywords.repeating.everyYear]

    // Try each category in order of specificity
    const repeatingCategories: Array<{ keywords: string[]; value: string }> = [
      { keywords: dailyKeywords, value: 'daily' },
      { keywords: [...keywords.repeating.weekly, ...keywords.repeating.everyWeek], value: 'weekly' },
      { keywords: monthlyKeywords, value: 'monthly' },
      { keywords: yearlyKeywords, value: 'yearly' },
    ]

    for (const category of repeatingCategories) {
      const regex = buildKeywordRegex(category.keywords)
      const match = title.match(regex)
      if (match) {
        repeating = category.value
        // Remove the repeating keyword from title
        title = title.replace(regex, '').replace(/\s+/g, ' ').trim()
        break
      }
    }
  }

  // Parse date keywords using the utility function
  // Skip if we already set a date from the repeating pattern (e.g., "weekly Monday")
  // Build localized date keywords regex
  const allDateKeywords = [
    ...keywords.dates.today,
    ...keywords.dates.tomorrow,
    ...keywords.dates.nextWeek,
    ...keywords.dates.thisWeek,
    ...keywords.dates.monday,
    ...keywords.dates.tuesday,
    ...keywords.dates.wednesday,
    ...keywords.dates.thursday,
    ...keywords.dates.friday,
    ...keywords.dates.saturday,
    ...keywords.dates.sunday,
  ]
  const dateRegex = buildKeywordRegex(allDateKeywords)
  const dateMatch = title.match(dateRegex)
  if (dateMatch && !dueDateTime) {
    const dateKeyword = dateMatch[1].toLowerCase()

    // Map localized keyword to English for parseRelativeDate
    let englishKeyword = dateKeyword
    if (keywords.dates.today.some(k => k.toLowerCase() === dateKeyword)) englishKeyword = 'today'
    else if (keywords.dates.tomorrow.some(k => k.toLowerCase() === dateKeyword)) englishKeyword = 'tomorrow'
    else if (keywords.dates.nextWeek.some(k => k.toLowerCase() === dateKeyword)) englishKeyword = 'next week'
    else if (keywords.dates.thisWeek.some(k => k.toLowerCase() === dateKeyword)) englishKeyword = 'this week'
    else {
      const mappedDay = mapLocalizedDay(dateKeyword, keywords)
      if (mappedDay) englishKeyword = mappedDay
    }

    dueDateTime = parseRelativeDate(englishKeyword) || undefined

    // Remove the date keyword from title
    title = title.replace(dateRegex, '').replace(/\s+/g, ' ').trim()
  } else if (dateMatch && dueDateTime) {
    // Still remove the date keyword from title even if we already have a date
    title = title.replace(dateRegex, '').replace(/\s+/g, ' ').trim()
  }

  // Parse priority keywords
  const priorityCategories: Array<{ keywords: string[]; value: number }> = [
    { keywords: keywords.priorities.highest, value: 3 },
    { keywords: keywords.priorities.high, value: 2 },
    { keywords: keywords.priorities.medium, value: 1 },
    { keywords: keywords.priorities.low, value: 0 },
  ]

  for (const category of priorityCategories) {
    const regex = buildKeywordRegex(category.keywords)
    const match = title.match(regex)
    if (match) {
      priority = category.value
      // Remove the priority keyword from title
      title = title.replace(regex, '').replace(/\s+/g, ' ').trim()
      break
    }
  }

  // Parse assignee keywords (simplified - look for "assign to [name]" or "for [name]")
  const assigneeRegex = /(assign to|assigned to|for)\s+(\w+)/i
  const assigneeMatch = title.match(assigneeRegex)
  if (assigneeMatch) {
    const assigneeName = assigneeMatch[2].toLowerCase()

    // Simple matching - in a real app, you'd have a proper user lookup
    if (assigneeName.includes('jon')) {
      assigneeId = effectiveSession?.user?.id // For now, assign to current user
    }

    // Remove the assignee keyword from title
    title = title.replace(assigneeRegex, '').trim()
  }

  // Get list defaults
  const selectedList = lists?.find(list => list.id === selectedListId)
  const listDefaults = {
    assignee: selectedList?.defaultAssignee,
    assigneeId: selectedList?.defaultAssigneeId,
    priority: selectedList?.defaultPriority,
    repeating: selectedList?.defaultRepeating,
    isPrivate: selectedList?.defaultIsPrivate,
    dueDate: selectedList?.defaultDueDate,
  }

  // Combine extracted hashtag list IDs with selected list ID
  let finalListIds: string[] = []

  // Add hashtag-extracted list IDs first
  if (extractedListIds.length > 0) {
    finalListIds = [...extractedListIds]
  }

  // Add selected list ID if it's not virtual and not already included
  if (selectedListId && !isVirtualListId(selectedListId) && !finalListIds.includes(selectedListId)) {
    finalListIds.push(selectedListId)
  }

  // IMPORTANT: Only return explicitly parsed values from title
  // Do NOT apply defaults here - that's handled by applyTaskDefaultsWithPriority
  const result = {
    title: title || input.trim(), // Fallback to original if title becomes empty
    dueDateTime: dueDateTime || undefined, // Only use parsed date from title, NOT list defaults
    priority: priority || undefined, // Only set if explicitly parsed
    assigneeId: assigneeId, // Only set if explicitly parsed (undefined if not)
    listIds: finalListIds,
    isPrivate: undefined, // Let defaults system handle this
    repeating: repeating, // Parsed from title (daily, weekly, monthly, yearly, custom)
    customRepeatingData: customRepeatingData // For custom weekly patterns with specific days
  }

  log.info({
    input,
    selectedListId,
    selectedList: selectedList ? {
      id: selectedList.id,
      name: selectedList.name,
      defaultAssigneeId: selectedList.defaultAssigneeId,
      defaultAssignee: selectedList.defaultAssignee,
      defaultPriority: selectedList.defaultPriority,
      defaultDueDate: selectedList.defaultDueDate
    } : null,
    parsedValues: { assigneeId, priority, dueDateTime, extractedListIds },
    listDefaults,
    finalResult: result
  }, '📝 parseTaskInput result:')

  return result
}

/**
 * Get count of incomplete tasks for a specific list
 */
export function getTaskCountForList(tasks: Task[], listId: string): number {
  if (!tasks || !listId) return 0
  return tasks.filter(task =>
    !task.completed && task.lists && task.lists.some(taskList => taskList.id === listId)
  ).length
}

/**
 * Get count of tasks for a virtual/saved filter list
 */
export function getSavedFilterTaskCount(tasks: Task[], list: TaskList, userId?: string): number {
  if (!list || !list.isVirtual || !userId) {
    return 0
  }

  // Apply virtual list filtering to get all matching tasks
  const filteredTasks = applyVirtualListFilter(tasks, list, userId)

  // Count based on the list's completion filter setting
  if (list.filterCompletion === "completed") {
    // For completed-only filters, count completed tasks
    return filteredTasks.filter(task => task.completed).length
  } else if (list.filterCompletion === "all") {
    // For show-all filters, count all tasks
    return filteredTasks.length
  } else {
    // Default and "incomplete" - count only incomplete tasks
    return filteredTasks.filter(task => !task.completed).length
  }
}

/**
 * Check if user can edit list settings
 */
export { canEditListSettings } from "@/lib/list-permissions"


/**
 * Get fixed list task count (for built-in lists like "my-tasks", "today", etc.)
 */
export function getFixedListTaskCount(tasks: Task[], listType: string, userId?: string): number {
  if (!tasks || !listType || !userId) return 0

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (listType) {
    case "my-tasks":
      return tasks.filter(task =>
        !task.completed && task.assigneeId === userId
      ).length
    case "today":
      return tasks.filter(task => {
        if (!task.dueDateTime || task.completed) return false
        const taskDate = new Date(task.dueDateTime)
        return (
          taskDate.getFullYear() === today.getFullYear() &&
          taskDate.getMonth() === today.getMonth() &&
          taskDate.getDate() === today.getDate()
        )
      }).length
    case "not-in-list":
      return tasks.filter(task =>
        !task.completed && (!task.lists || task.lists.length === 0)
      ).length
    case "assigned":
      return tasks.filter(task =>
        !task.completed && task.creatorId === userId && task.assigneeId !== userId && task.assigneeId !== null
      ).length
    default:
      return 0
  }
}

/**
 * Get My Tasks filter text based on active filters
 * Returns formatted string like "This Week", "!! Only", "Today !!! Only", "○ Only", etc.
 */
export function getMyTasksFilterText(filters: {
  filterDueDate?: string
  filterPriority?: number[]
}): string {
  const { filterDueDate = 'all', filterPriority = [] } = filters

  const hasDateFilter = filterDueDate && filterDueDate !== 'all'
  const hasPriorityFilter = filterPriority && filterPriority.length > 0

  // No filters active
  if (!hasDateFilter && !hasPriorityFilter) {
    return ''
  }

  // Get date filter text
  let dateText = ''
  if (hasDateFilter) {
    switch (filterDueDate) {
      case 'today':
        dateText = 'Today'
        break
      case 'this_week':
        dateText = 'This Week'
        break
      case 'this_month':
        dateText = 'This Month'
        break
      case 'overdue':
        dateText = 'Overdue'
        break
      case 'no_date':
        dateText = 'No Date'
        break
      default:
        dateText = ''
    }
  }

  // Get priority filter text (including ○ for priority 0)
  let priorityText = ''
  if (hasPriorityFilter && filterPriority.length > 0) {
    // Sort priorities in descending order to show highest first
    const sortedPriorities = [...filterPriority].sort((a, b) => b - a)

    // Convert priority numbers to symbols
    const priorityMarks = sortedPriorities.map(p => {
      switch (p) {
        case 3: return '!!!'
        case 2: return '!!'
        case 1: return '!'
        case 0: return '○' // Priority 0 shows as ○
        default: return ''
      }
    }).filter(mark => mark !== '')

    if (priorityMarks.length > 0) {
      priorityText = `${priorityMarks.join(' ')} Only`
    }
  }

  // Combine date and priority filters
  if (dateText && priorityText) {
    return `${dateText} ${priorityText}`
  } else if (dateText) {
    return dateText
  } else if (priorityText) {
    return priorityText
  }

  return ''
}

/**
 * Get Tailwind color class for priority number
 * Maps priority (0-3) to corresponding color
 */
export function getPriorityColorClass(priority: number): string {
  switch (priority) {
    case 3: // Highest priority - red
      return 'text-red-500'
    case 2: // High priority - orange/yellow
      return 'text-orange-500'
    case 1: // Medium priority - blue
      return 'text-blue-500'
    case 0: // Low/no priority - gray
      return 'text-gray-400'
    default:
      return 'text-gray-400'
  }
}