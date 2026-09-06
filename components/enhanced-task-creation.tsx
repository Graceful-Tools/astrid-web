"use client"

import React, { useCallback, useMemo, useState } from 'react'
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Keyboard, Hash } from "lucide-react"
import type { TaskList } from '@/types/task'
import { useTranslations } from "@/lib/i18n/client"

export type LayoutType = '1-column' | '2-column' | '3-column'

interface EnhancedTaskCreationProps {
  layoutType: LayoutType
  selectedListId: string
  availableLists: TaskList[]
  quickTaskInput: string
  setQuickTaskInput: (value: string) => void
  onCreateTask: (title: string, options?: { priority?: number; assigneeId?: string | null; navigateToDetail?: boolean }) => Promise<string | null>
  onKeyDown: (e: React.KeyboardEvent) => void
  isMobile: boolean
  isSessionReady: boolean
  className?: string
}

interface InputConfig {
  width: string
  placeholder: string
  buttonText: string
  showKeyboardHint: boolean
}

interface ContextualDefaults {
  priority: number
  assignee?: any
  dueDate?: string
  isPrivate: boolean
  listName: string
}

export function EnhancedTaskCreation({
  layoutType,
  selectedListId,
  availableLists,
  quickTaskInput,
  setQuickTaskInput,
  onCreateTask,
  onKeyDown,
  isMobile,
  isSessionReady,
  className = ""
}: EnhancedTaskCreationProps) {
  const { t } = useTranslations()
  const [isCreating, setIsCreating] = useState(false)
  const [showHashtagSuggestions, setShowHashtagSuggestions] = useState(false)
  const [hashtagSuggestions, setHashtagSuggestions] = useState<TaskList[]>([])
  const [activeHashtagIndex, setActiveHashtagIndex] = useState(0)

  // Get optimal input configuration based on layout
  const getOptimalInputConfig = useCallback((): InputConfig => {
    switch (layoutType) {
      case '3-column':
        return {
          width: 'w-full',
          placeholder: t('tasks.addTaskToCurrentList'),
          buttonText: isMobile ? '' : 'Add Task',
          showKeyboardHint: false
        }
      case '2-column':
        return {
          width: 'w-full',
          placeholder: t('tasks.addTaskShort'),
          buttonText: isMobile ? '' : 'Add Task',
          showKeyboardHint: false
        }
      case '1-column':
        return {
          width: 'w-full',
          placeholder: isMobile ? t('tasks.quickAdd') : t('tasks.addNewTask'),
          buttonText: isMobile ? '' : 'Add Task',
          showKeyboardHint: false
        }
    }
  }, [layoutType, isMobile, t])

  // Get contextual defaults based on selected list
  const getContextualDefaults = useCallback((): ContextualDefaults => {
    const currentList = availableLists.find(l => l.id === selectedListId)

    return {
      priority: currentList?.defaultPriority || 0,
      assignee: currentList?.defaultAssignee,
      dueDate: currentList?.defaultDueDate,
      isPrivate: currentList?.defaultIsPrivate ?? (selectedListId === 'my-tasks'),
      listName: currentList?.name || 'My Tasks'
    }
  }, [availableLists, selectedListId])

  const inputConfig = useMemo(() => getOptimalInputConfig(), [getOptimalInputConfig])
  const contextualDefaults = useMemo(() => getContextualDefaults(), [getContextualDefaults])

  // Enhanced placeholder with context
  const getEnhancedPlaceholder = useCallback(() => {
    const baseConfig = getOptimalInputConfig()

    if (layoutType === '3-column' && contextualDefaults.listName !== 'My Tasks') {
      return t("tasks.addTaskToList", { listName: contextualDefaults.listName })
    }

    return baseConfig.placeholder
  }, [layoutType, contextualDefaults.listName, getOptimalInputConfig, t])

  // Handle task creation with enhanced context
  const handleCreateTask = useCallback(async () => {
    if (!quickTaskInput.trim() || !isSessionReady || isCreating) return

    setIsCreating(true)
    try {
      await onCreateTask(quickTaskInput.trim())
      setQuickTaskInput("")
    } catch (error) {
      console.error('Enhanced task creation error:', error)
    } finally {
      setIsCreating(false)
    }
  }, [quickTaskInput, isSessionReady, isCreating, onCreateTask, setQuickTaskInput])

  // Detect hashtag and show suggestions
  const handleInputChange = useCallback((value: string) => {
    setQuickTaskInput(value)

    // Detect if user is typing a hashtag
    const cursorPosition = value.length // Assume cursor is at end for simplicity
    const textBeforeCursor = value.substring(0, cursorPosition)
    // Allow any non-whitespace characters in hashtag autocomplete
    const hashtagMatch = textBeforeCursor.match(/#([^\s]*)$/)

    if (hashtagMatch) {
      const hashtagQuery = hashtagMatch[1].toLowerCase()
      // Filter available lists (exclude virtual lists)
      const realLists = availableLists.filter(list => !list.isVirtual)
      const matches = realLists.filter(list =>
        list.name.toLowerCase().includes(hashtagQuery) ||
        list.name.toLowerCase().replace(/\s+/g, '-').includes(hashtagQuery) ||
        list.name.toLowerCase().replace(/\s+/g, '_').includes(hashtagQuery)
      ).slice(0, 5) // Limit to 5 suggestions

      setHashtagSuggestions(matches)
      setShowHashtagSuggestions(matches.length > 0)
      setActiveHashtagIndex(0)
    } else {
      setShowHashtagSuggestions(false)
    }
  }, [setQuickTaskInput, availableLists])

  // Handle hashtag suggestion selection
  const selectHashtagSuggestion = useCallback((list: TaskList) => {
    // Replace the current hashtag with the selected list name
    const textBeforeCursor = quickTaskInput
    // Allow any non-whitespace characters in hashtag matching
    const hashtagMatch = textBeforeCursor.match(/#([^\s]*)$/)

    if (hashtagMatch) {
      const hashtagStart = hashtagMatch.index!
      const listHashtag = list.name.toLowerCase().replace(/\s+/g, '-')
      const newValue = textBeforeCursor.substring(0, hashtagStart) + '#' + listHashtag + ' '
      setQuickTaskInput(newValue)
      setShowHashtagSuggestions(false)
    }
  }, [quickTaskInput, setQuickTaskInput])

  // Enhanced keyboard handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Handle hashtag suggestions navigation
    if (showHashtagSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveHashtagIndex(prev => (prev + 1) % hashtagSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveHashtagIndex(prev => (prev - 1 + hashtagSuggestions.length) % hashtagSuggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (hashtagSuggestions[activeHashtagIndex]) {
          selectHashtagSuggestion(hashtagSuggestions[activeHashtagIndex])
        }
        return
      }
      if (e.key === 'Escape') {
        setShowHashtagSuggestions(false)
        e.preventDefault()
        return
      }
    }

    // Call original handler
    onKeyDown(e)

    // Add enhanced keyboard shortcuts
    if (e.key === 'Escape') {
      setQuickTaskInput("")
      e.preventDefault()
    }
  }, [onKeyDown, setQuickTaskInput, showHashtagSuggestions, hashtagSuggestions, activeHashtagIndex, selectHashtagSuggestion])

  // Layout-specific container classes
  const getContainerClasses = () => {
    const baseClasses = "flex items-center gap-2 transition-all duration-200"

    return `${baseClasses} ${inputConfig.width}`
  }

  // Input styling based on layout
  const getInputClasses = () => {
    const baseClasses = `
      theme-input theme-text-primary rounded-lg transition-all duration-200
      focus:ring-2 focus:ring-blue-500 focus:border-transparent
      ${isMobile ? 'mobile-input text-base' : 'text-sm'}
    `

    switch (layoutType) {
      case '3-column':
        return `${baseClasses} flex-1 min-w-0`
      case '2-column':
        return `${baseClasses} flex-1`
      case '1-column':
        return `${baseClasses} flex-1`
      default:
        return baseClasses
    }
  }

  // Button styling based on layout
  const getButtonClasses = () => {
    const baseClasses = `
      bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200
      disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-blue-500
      ${isCreating ? 'animate-pulse' : ''}
    `

    // Mobile-specific styling for plus-only button
    const mobileClasses = isMobile ? 'font-bold p-3' : ''

    switch (layoutType) {
      case '3-column':
        return `${baseClasses} ${mobileClasses} ${isMobile ? '' : 'px-3 py-2 text-sm whitespace-nowrap'}`
      case '2-column':
        return `${baseClasses} ${mobileClasses} ${isMobile ? '' : 'px-4 py-2 text-sm'}`
      case '1-column':
        return `${baseClasses} ${mobileClasses} ${isMobile ? '' : 'px-4 py-2'}`
      default:
        return `${baseClasses} ${mobileClasses}`
    }
  }

  return (
    <div className={`${getContainerClasses()} ${className}`}>
      {/* Enhanced Input */}
      <div className="relative flex-1">
        <Input
          placeholder={getEnhancedPlaceholder()}
          value={quickTaskInput}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className={getInputClasses()}
          disabled={!isSessionReady || isCreating}
          autoComplete="off"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck={true}
          {...(isMobile ? {
            inputMode: 'text' as const,
            enterKeyHint: 'done' as const
          } : {})}
        />

        {/* Hashtag Suggestions Dropdown */}
        {showHashtagSuggestions && hashtagSuggestions.length > 0 && (
          <div className="absolute z-50 w-full bottom-full mb-1 theme-bg-primary theme-border border rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {hashtagSuggestions.map((list, index) => {
              const isPublicOrShared = list.privacy === 'PUBLIC' ||
                (list.listMembers && list.listMembers.length > 1) ||
                (list.members && list.members.length > 0) ||
                (list.admins && list.admins.length > 0)

              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => selectHashtagSuggestion(list)}
                  className={`w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-2 transition-colors ${
                    index === activeHashtagIndex ? 'bg-blue-100 dark:bg-blue-900/50' : ''
                  }`}
                >
                  {isPublicOrShared ? (
                    <span className="text-blue-600 dark:text-blue-400 font-mono text-sm flex-shrink-0">#</span>
                  ) : (
                    <Hash className="w-3 h-3 flex-shrink-0" style={{ color: list.color || DEFAULT_LIST_COLOR }} />
                  )}
                  <span className="theme-text-primary flex-1 truncate">{list.name}</span>
                  <span className="text-xs theme-text-muted flex-shrink-0">
                    #{list.name.toLowerCase().replace(/\s+/g, '-')}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Loading indicator */}
        {isCreating && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          </div>
        )}
      </div>

      {/* Enhanced Button */}
      <Button
        onClick={handleCreateTask}
        disabled={!isSessionReady || !quickTaskInput.trim() || isCreating}
        className={getButtonClasses()}
        title={inputConfig.showKeyboardHint ? "Press Enter to create task" : undefined}
      >
        <Plus className={`w-4 h-4 ${inputConfig.buttonText ? 'mr-1' : ''}`} />
        {inputConfig.buttonText}
      </Button>

      {/* Keyboard hint for desktop */}
      {inputConfig.showKeyboardHint && !isMobile && (
        <div className="flex items-center gap-1 text-xs theme-text-muted">
          <Keyboard className="w-3 h-3" />
          <span>Enter</span>
        </div>
      )}

    </div>
  )
}

// Helper hook for detecting layout type based on screen size
export function useLayoutType(): LayoutType {
  const [layoutType, setLayoutType] = React.useState<LayoutType>('1-column')

  React.useEffect(() => {
    const updateLayoutType = () => {
      const width = window.innerWidth
      if (width >= 1200) {
        setLayoutType('3-column')
      } else if (width >= 768) {
        setLayoutType('2-column')
      } else {
        setLayoutType('1-column')
      }
    }

    updateLayoutType()
    window.addEventListener('resize', updateLayoutType)
    return () => window.removeEventListener('resize', updateLayoutType)
  }, [])

  return layoutType
}

export default EnhancedTaskCreation