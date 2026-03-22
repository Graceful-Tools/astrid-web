"use client"

import { useState, useMemo, useCallback, useRef } from 'react'
import type { User } from '@/types/task'

interface UseChatMentionsProps {
  mentionableUsers: User[]
  currentUserId: string
}

interface UseChatMentionsReturn {
  mentionSearch: string | null
  mentionCursorPos: number
  filteredMentionUsers: User[]
  handleTextChange: (value: string, cursorPos: number) => { shouldShowMentions: boolean }
  insertMention: (user: User, currentText: string) => { newText: string; newCursorPos: number }
  clearMention: () => void
}

export function useChatMentions({ mentionableUsers, currentUserId }: UseChatMentionsProps): UseChatMentionsReturn {
  const [mentionSearch, setMentionSearch] = useState<string | null>(null)
  const [mentionCursorPos, setMentionCursorPos] = useState<number>(0)

  const filteredUsers = useMemo(() => {
    const users = mentionableUsers.filter(u => u.id !== currentUserId)
    if (!mentionSearch) return users
    const search = mentionSearch.toLowerCase()
    return users.filter(u =>
      (u.name?.toLowerCase().includes(search)) ||
      (u.email.toLowerCase().includes(search))
    )
  }, [mentionableUsers, currentUserId, mentionSearch])

  const handleTextChange = useCallback((value: string, cursorPos: number) => {
    const textBeforeCursor = value.substring(0, cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf('@')

    if (atIndex !== -1 && (atIndex === 0 || /\s/.test(textBeforeCursor[atIndex - 1]))) {
      const search = textBeforeCursor.substring(atIndex + 1)
      if (!/\s/.test(search)) {
        setMentionSearch(search)
        setMentionCursorPos(atIndex)
        return { shouldShowMentions: true }
      }
    }

    setMentionSearch(null)
    return { shouldShowMentions: false }
  }, [])

  const insertMention = useCallback((user: User, currentText: string) => {
    const textBefore = currentText.substring(0, mentionCursorPos)
    const textAfter = currentText.substring(mentionCursorPos + (mentionSearch?.length || 0) + 1)
    const mentionText = `@[${user.name || user.email}](${user.id}) `
    const newText = textBefore + mentionText + textAfter
    const newCursorPos = mentionCursorPos + mentionText.length

    setMentionSearch(null)
    return { newText, newCursorPos }
  }, [mentionCursorPos, mentionSearch])

  const clearMention = useCallback(() => {
    setMentionSearch(null)
  }, [])

  return {
    mentionSearch,
    mentionCursorPos,
    filteredMentionUsers: filteredUsers,
    handleTextChange,
    insertMention,
    clearMention,
  }
}
