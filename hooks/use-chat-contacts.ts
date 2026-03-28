"use client"

import { useState, useEffect } from 'react'
import type { User } from '@/types/task'

/**
 * Fetches all users the current user shares any list with (contact graph)
 * Combined with AI agents, for use as mentionable users in virtual list chats.
 */
export function useChatContacts(userId?: string, enabled = true) {
  const [contacts, setContacts] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!userId || !enabled) return

    const fetchContacts = async () => {
      setIsLoading(true)
      try {
        // Fetch lists to get all co-members
        const res = await fetch('/api/lists')
        if (!res.ok) return

        const lists = await res.json()
        const userMap = new Map<string, User>()

        for (const list of lists) {
          // Add owner
          if (list.owner && list.owner.id !== userId) {
            userMap.set(list.owner.id, list.owner)
          }
          // Add list members
          if (list.listMembers) {
            for (const member of list.listMembers) {
              if (member.user && member.user.id !== userId) {
                userMap.set(member.user.id, member.user)
              }
            }
          }
        }

        setContacts(Array.from(userMap.values()))
      } catch (err) {
        console.error('[useChatContacts] Error:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchContacts()
  }, [userId, enabled])

  return { contacts, isLoading }
}
