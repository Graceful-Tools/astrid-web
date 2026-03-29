"use client"

import { useState, useMemo, useCallback, useRef } from 'react'
import type { User, TaskList, Task } from '@/types/task'

// Trigger characters and their autocomplete types
export type AutocompleteType = 'mention' | 'list' | 'task'

export interface AutocompleteItem {
  id: string
  type: AutocompleteType
  label: string
  secondaryLabel?: string
  image?: string | null
  isAIAgent?: boolean
  isShared?: boolean
  privacy?: string
  completed?: boolean
}

interface UseChatMentionsProps {
  mentionableUsers: User[]
  currentUserId: string
  lists?: TaskList[]
  tasks?: Task[]
  selectedListId?: string
}

interface UseChatMentionsReturn {
  // Active autocomplete state
  autocompleteType: AutocompleteType | null
  autocompleteSearch: string | null
  autocompleteItems: AutocompleteItem[]
  selectedIndex: number
  // Legacy compat
  mentionSearch: string | null
  mentionCursorPos: number
  filteredMentionUsers: User[]
  // Handlers
  handleTextChange: (value: string, cursorPos: number) => { shouldShowMentions: boolean }
  insertMention: (user: User, currentText: string) => { newText: string; newCursorPos: number }
  insertAutocompleteItem: (item: AutocompleteItem, currentText: string) => { newText: string; newCursorPos: number }
  clearMention: () => void
  // Keyboard nav
  selectNext: () => void
  selectPrev: () => void
  selectCurrent: () => AutocompleteItem | null
}

const TRIGGER_CHARS: Record<string, AutocompleteType> = {
  '@': 'mention',
  '#': 'list',
  '!': 'task',
}

export function useChatMentions({
  mentionableUsers,
  currentUserId,
  lists = [],
  tasks = [],
  selectedListId,
}: UseChatMentionsProps): UseChatMentionsReturn {
  const [autocompleteType, setAutocompleteType] = useState<AutocompleteType | null>(null)
  const [autocompleteSearch, setAutocompleteSearch] = useState<string | null>(null)
  const [triggerPos, setTriggerPos] = useState<number>(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const triggerCharRef = useRef<string>('@')

  // Filter users for @ mentions
  const filteredUsers = useMemo(() => {
    const users = mentionableUsers.filter(u => u.id !== currentUserId)
    if (!autocompleteSearch || autocompleteType !== 'mention') return users
    const search = autocompleteSearch.toLowerCase()
    return users.filter(u =>
      (u.name?.toLowerCase().includes(search)) ||
      (u.email.toLowerCase().includes(search))
    )
  }, [mentionableUsers, currentUserId, autocompleteSearch, autocompleteType])

  // Filter lists for # references
  const filteredLists = useMemo(() => {
    if (autocompleteType !== 'list') return []
    const search = (autocompleteSearch || '').toLowerCase()
    return lists
      .filter(l => !l.isVirtual) // Only real lists
      .filter(l => !search || l.name.toLowerCase().includes(search))
      .slice(0, 10)
  }, [lists, autocompleteSearch, autocompleteType])

  // Filter tasks for ! references — incomplete first, then recent completed
  const filteredTasks = useMemo(() => {
    if (autocompleteType !== 'task') return []
    const search = (autocompleteSearch || '').toLowerCase()

    // Get tasks from the selected list first, then others
    const selectedListTasks: Task[] = []
    const otherTasks: Task[] = []

    for (const task of tasks) {
      if (search && !task.title.toLowerCase().includes(search)) continue
      const inSelectedList = task.lists?.some(l => l.id === selectedListId)
      if (inSelectedList) {
        selectedListTasks.push(task)
      } else {
        otherTasks.push(task)
      }
    }

    // Sort: incomplete first, then by most recently updated
    const sortTasks = (a: Task, b: Task) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    }

    selectedListTasks.sort(sortTasks)
    otherTasks.sort(sortTasks)

    return [...selectedListTasks, ...otherTasks].slice(0, 15)
  }, [tasks, autocompleteSearch, autocompleteType, selectedListId])

  // Build unified autocomplete items
  const autocompleteItems = useMemo((): AutocompleteItem[] => {
    if (!autocompleteType) return []

    switch (autocompleteType) {
      case 'mention':
        return filteredUsers.map(u => ({
          id: u.id,
          type: 'mention' as const,
          label: u.name || u.email,
          secondaryLabel: u.name ? u.email : undefined,
          image: u.image,
          isAIAgent: u.isAIAgent,
        }))
      case 'list':
        return filteredLists.map(l => ({
          id: l.id,
          type: 'list' as const,
          label: l.name,
          secondaryLabel: l.privacy === 'SHARED' ? 'Shared' : l.privacy === 'PUBLIC' ? 'Public' : undefined,
          isShared: l.privacy === 'SHARED' || l.privacy === 'PUBLIC',
          privacy: l.privacy,
        }))
      case 'task':
        return filteredTasks.map(t => ({
          id: t.id,
          type: 'task' as const,
          label: t.title,
          secondaryLabel: t.lists?.[0]?.name,
          completed: t.completed,
        }))
      default:
        return []
    }
  }, [autocompleteType, filteredUsers, filteredLists, filteredTasks])

  const handleTextChange = useCallback((value: string, cursorPos: number) => {
    const textBeforeCursor = value.substring(0, cursorPos)

    // Check each trigger character, prioritizing the one closest to cursor
    let bestTrigger: { char: string; type: AutocompleteType; pos: number; search: string } | null = null

    for (const [char, type] of Object.entries(TRIGGER_CHARS)) {
      const idx = textBeforeCursor.lastIndexOf(char)
      if (idx === -1) continue
      // Must be at start or after whitespace
      if (idx > 0 && !/\s/.test(textBeforeCursor[idx - 1])) continue
      const search = textBeforeCursor.substring(idx + 1)
      // No spaces in search (means they've moved past the trigger)
      if (/\s/.test(search)) continue
      // Take the closest trigger to cursor
      if (!bestTrigger || idx > bestTrigger.pos) {
        bestTrigger = { char, type, pos: idx, search }
      }
    }

    if (bestTrigger) {
      setAutocompleteType(bestTrigger.type)
      setAutocompleteSearch(bestTrigger.search)
      setTriggerPos(bestTrigger.pos)
      setSelectedIndex(0)
      triggerCharRef.current = bestTrigger.char
      return { shouldShowMentions: true }
    }

    setAutocompleteType(null)
    setAutocompleteSearch(null)
    return { shouldShowMentions: false }
  }, [])

  const insertAutocompleteItem = useCallback((item: AutocompleteItem, currentText: string) => {
    const searchLen = autocompleteSearch?.length || 0
    const textBefore = currentText.substring(0, triggerPos)
    const textAfter = currentText.substring(triggerPos + searchLen + 1) // +1 for trigger char

    let ref: string
    switch (item.type) {
      case 'mention':
        ref = `@[${item.label}](${item.id})`
        break
      case 'list':
        ref = `#[${item.label}](${item.id})`
        break
      case 'task':
        ref = `![${item.label}](${item.id})`
        break
    }

    // Add a single space after the reference only if textAfter doesn't already start with one
    const separator = textAfter.startsWith(' ') ? '' : ' '
    const insertText = ref + separator
    const newText = textBefore + insertText + textAfter
    const newCursorPos = triggerPos + insertText.length

    setAutocompleteType(null)
    setAutocompleteSearch(null)
    setSelectedIndex(0)
    return { newText, newCursorPos }
  }, [triggerPos, autocompleteSearch])

  // Legacy insertMention for backward compat
  const insertMention = useCallback((user: User, currentText: string) => {
    const item: AutocompleteItem = {
      id: user.id,
      type: 'mention',
      label: user.name || user.email,
      image: user.image,
      isAIAgent: user.isAIAgent,
    }
    return insertAutocompleteItem(item, currentText)
  }, [insertAutocompleteItem])

  const clearMention = useCallback(() => {
    setAutocompleteType(null)
    setAutocompleteSearch(null)
    setSelectedIndex(0)
  }, [])

  const selectNext = useCallback(() => {
    setSelectedIndex(prev => {
      const max = autocompleteItems.length - 1
      return prev >= max ? 0 : prev + 1
    })
  }, [autocompleteItems.length])

  const selectPrev = useCallback(() => {
    setSelectedIndex(prev => {
      const max = autocompleteItems.length - 1
      return prev <= 0 ? max : prev - 1
    })
  }, [autocompleteItems.length])

  const selectCurrent = useCallback((): AutocompleteItem | null => {
    if (autocompleteItems.length === 0) return null
    return autocompleteItems[selectedIndex] || null
  }, [autocompleteItems, selectedIndex])

  return {
    autocompleteType,
    autocompleteSearch,
    autocompleteItems,
    selectedIndex,
    // Legacy compat
    mentionSearch: autocompleteType === 'mention' ? autocompleteSearch : null,
    mentionCursorPos: triggerPos,
    filteredMentionUsers: filteredUsers,
    // Handlers
    handleTextChange,
    insertMention,
    insertAutocompleteItem,
    clearMention,
    selectNext,
    selectPrev,
    selectCurrent,
  }
}
