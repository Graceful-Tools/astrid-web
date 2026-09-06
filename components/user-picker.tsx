"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Check, X, Mail, UserPlus, Bot, Sparkles } from "lucide-react"
import type { User } from "../types/task"
import { isCodingAgent } from "@/lib/ai-agent-utils"
import { useTranslations } from "@/lib/i18n/client"

interface UserPickerProps {
  selectedUser?: User | null
  onUserSelect: (user: User | null, assigneeEmail?: string) => void
  onInviteUser?: (email: string, message?: string) => void
  placeholder?: string
  className?: string
  taskId?: string
  listIds?: string[]
  inline?: boolean // When true, hide the selected user display (for inline editing mode)
  autoFocus?: boolean // When true, automatically focus input and show suggestions on mount
  allowEmailAssignment?: boolean // When true, allow direct email assignment (creates placeholder users)
  includeAIAgents?: boolean // When true, include AI agents based on user's configured API keys
}

interface SearchUser {
  id: string
  name: string | null
  email: string
  image: string | null
  isListMember?: boolean
  accessWarning?: string
  isAIAgent?: boolean
  aiAgentType?: string | null
}

export function UserPicker({
  selectedUser,
  onUserSelect,
  onInviteUser,
  placeholder = "Search users or enter email...",
  className = "",
  taskId,
  listIds,
  inline = false,
  autoFocus = false,
  allowEmailAssignment = true,
  includeAIAgents = false
}: UserPickerProps) {
  const { t } = useTranslations()
  const [searchTerm, setSearchTerm] = useState("")
  const [searchResults, setSearchResults] = useState<SearchUser[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isSearching, setIsSearching] = useState(false)
  const [inviteMessage, setInviteMessage] = useState("")
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [showAccessWarning, setShowAccessWarning] = useState(false)
  const [pendingUser, setPendingUser] = useState<SearchUser | null>(null)
  
  const searchRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)

  // Track mount status for cleanup
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Check if search term is a valid email
  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }

  // Search for users
  const searchUsers = useCallback(async (query: string) => {
    // For task assignment, show list members even with empty query
    // Also allow empty query when includeAIAgents is true (for My Tasks)
    const shouldSearch = query.length >= 2 || (taskId || (listIds && listIds.length > 0)) || includeAIAgents

    if (!shouldSearch) {
      if (isMountedRef.current) {
        setSearchResults([])
      }
      return
    }

    if (isMountedRef.current) {
      setIsSearching(true)
    }
    try {
      const params = new URLSearchParams({ q: query })
      if (taskId) params.append('taskId', taskId)
      if (listIds && listIds.length > 0) params.append('listIds', listIds.join(','))
      if (includeAIAgents) params.append('includeAIAgents', 'true')

      const response = await fetch(`/api/v1/users/search?${params.toString()}`)
      if (response.ok && isMountedRef.current) {
        const data = await response.json()
        setSearchResults(data.users || [])
      }
    } catch (error) {
      console.error("Error searching users:", error)
    } finally {
      if (isMountedRef.current) {
        setIsSearching(false)
      }
    }
  }, [taskId, listIds, includeAIAgents])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      searchUsers(searchTerm)
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [searchTerm, searchUsers])

  // Initial load of list members when component mounts
  useEffect(() => {
    if ((taskId || (listIds && listIds.length > 0)) && searchTerm === "") {
      searchUsers("")
    }
  }, [taskId, listIds, searchTerm, searchUsers])

  // Auto-focus and show suggestions when autoFocus is true
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      // Focus the input
      inputRef.current.focus()
      // Show suggestions immediately
      setShowSuggestions(true)
      // Trigger initial search for list members
      if (taskId || (listIds && listIds.length > 0)) {
        searchUsers("")
      }
    }
  }, [autoFocus, taskId, listIds, searchUsers])

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
        setSelectedIndex(-1)
        setShowInviteForm(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleUserSelect = (user: SearchUser) => {
    // Handle special "unassigned" option
    if (user.id === 'unassigned') {
      onUserSelect(null)
      setSearchTerm("")
      setShowSuggestions(false)
      setSelectedIndex(-1)
      return
    }

    if (user.accessWarning) {
      // Show warning first, then proceed with selection
      setPendingUser(user)
      setShowAccessWarning(true)
      return
    }

    onUserSelect({
      id: user.id,
      name: user.name || user.email,
      email: user.email,
      image: user.image,
      createdAt: new Date()
    })
    setSearchTerm("")
    setShowSuggestions(false)
    setSelectedIndex(-1)
  }

  const confirmUserSelection = () => {
    if (pendingUser) {
      onUserSelect({
        id: pendingUser.id,
        name: pendingUser.name || pendingUser.email,
        email: pendingUser.email,
        image: pendingUser.image,
        createdAt: new Date()
      })
      setSearchTerm("")
      setShowSuggestions(false)
      setSelectedIndex(-1)
    }
    setShowAccessWarning(false)
    setPendingUser(null)
  }

  const cancelUserSelection = () => {
    setShowAccessWarning(false)
    setPendingUser(null)
  }

  const handleInviteUser = async () => {
    if (!isValidEmail(searchTerm) || !onInviteUser) return

    try {
      await onInviteUser(searchTerm, inviteMessage)
      setSearchTerm("")
      setInviteMessage("")
      setShowInviteForm(false)
      setShowSuggestions(false)
    } catch (error) {
      console.error("Error inviting user:", error)
    }
  }

  // Handle direct email assignment (creates placeholder user)
  const handleEmailAssignment = (email: string) => {
    // Call onUserSelect with null user but provide the email
    // This signals to the parent to use assigneeEmail instead of assigneeId
    onUserSelect(null, email)
    setSearchTerm("")
    setShowSuggestions(false)
    setSelectedIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const keyboardOptions = []

    // Add "Unassigned" option if search term is empty or matches "unassigned"
    const searchLower = searchTerm.toLowerCase()
    if (!searchTerm || 'unassigned'.includes(searchLower)) {
      keyboardOptions.push({ id: 'unassigned', name: 'Unassigned', email: '', image: null, isListMember: false })
    }

    // Add regular search results
    keyboardOptions.push(...searchResults)
    if (isValidEmail(searchTerm) && onInviteUser) {
      keyboardOptions.push({ id: 'invite', name: null, email: searchTerm, image: null })
    }

    const allOptions = keyboardOptions

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => prev < allOptions.length - 1 ? prev + 1 : 0)
      setShowSuggestions(true)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => prev > 0 ? prev - 1 : allOptions.length - 1)
      setShowSuggestions(true)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex >= 0 && allOptions[selectedIndex]) {
        const selected = allOptions[selectedIndex]
        if (selected.id === 'invite') {
          setShowInviteForm(true)
        } else {
          handleUserSelect(selected)
        }
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setSelectedIndex(-1)
      setShowInviteForm(false)
    }
  }

  const allOptions = []

  // Add "Unassigned" option if search term is empty or matches "unassigned"
  const searchLower = searchTerm.toLowerCase()
  if (!searchTerm || 'unassigned'.includes(searchLower)) {
    allOptions.push({ id: 'unassigned', name: 'Unassigned', email: '', image: null, isListMember: false })
  }

  // Add regular search results
  allOptions.push(...searchResults)
  if (isValidEmail(searchTerm) && onInviteUser && !searchResults.some(u => u.email === searchTerm)) {
    allOptions.push({ id: 'invite', name: null, email: searchTerm, image: null })
  }

  return (
    <div className={`relative ${className}`}>
      {/* Selected user display - only show when not in inline mode */}
      {!inline && selectedUser && (
        <div className="flex items-center space-x-2 p-2 bg-gray-700 rounded-lg border border-gray-600 mb-2">
          <Avatar className="w-6 h-6">
                            <AvatarImage src={selectedUser.image || "/placeholder.svg"} />
            <AvatarFallback>{selectedUser.name?.charAt(0) || selectedUser.email.charAt(0)}</AvatarFallback>
          </Avatar>
          <span className="text-white flex-1">{selectedUser.name || selectedUser.email}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onUserSelect(null)}
            className="p-1 h-auto text-gray-400 hover:text-red-400"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Search input */}
      <div className="relative" ref={searchRef}>
        <Input
          ref={inputRef}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value)
            setShowSuggestions(true)
            setSelectedIndex(-1)
          }}
          onFocus={() => {
            setShowSuggestions(true)
            setSelectedIndex(-1)
            // Trigger search for list members if we have no search term
            if (searchTerm === "" && (taskId || (listIds && listIds.length > 0))) {
              searchUsers("")
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="bg-gray-700 border-gray-600 text-white placeholder-gray-400"
        />

        {/* Search results dropdown */}
        {showSuggestions && allOptions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
            {allOptions.filter(option => option.id !== 'invite').map((user, index) => (
              <div
                key={user.id}
                onClick={() => handleUserSelect(user)}
                className={`flex items-center space-x-2 px-3 py-2 cursor-pointer ${
                  index === selectedIndex 
                    ? 'bg-blue-600 text-white' 
                    : 'hover:bg-gray-700 text-white'
                }`}
              >
                {user.id === 'unassigned' ? (
                  <Avatar className="w-6 h-6">
                    <AvatarImage src="/placeholder.svg" />
                    <AvatarFallback className="bg-gray-600 text-gray-300">{t('tasks.unassignedMark')}</AvatarFallback>
                  </Avatar>
                ) : (
                  <Avatar className="w-6 h-6">
                    <AvatarImage src={user.image || "/placeholder.svg"} />
                    <AvatarFallback>{user.name?.charAt(0) || user.email.charAt(0)}</AvatarFallback>
                  </Avatar>
                )}
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <div className="text-sm">{user.name || user.email}</div>
                    {user.isListMember && !isCodingAgent(user) && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100">
                        Member
                      </span>
                    )}
                  </div>
                  {user.name && (
                    <div className="text-xs text-gray-400">{user.email}</div>
                  )}
                  {user.accessWarning && (
                    <div className="text-xs text-yellow-400 mt-1">
                      ⚠️ {user.accessWarning}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Invite option */}
            {isValidEmail(searchTerm) && onInviteUser && !searchResults.some(u => u.email === searchTerm) && (
              <div
                onClick={() => setShowInviteForm(true)}
                className={`flex items-center space-x-2 px-3 py-2 cursor-pointer border-t border-gray-600 ${
                  allOptions.length - 1 === selectedIndex
                    ? 'bg-blue-600 text-white' 
                    : 'hover:bg-gray-700 text-blue-400'
                }`}
              >
                <UserPlus className="w-4 h-4" />
                <span className="text-sm">Invite {searchTerm}</span>
              </div>
            )}
          </div>
        )}

        {/* Invite form */}
        {showInviteForm && (
          <div className="absolute top-full left-0 right-0 mt-1 p-3 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-10">
            <div className="text-sm text-white mb-2">
              Invite {searchTerm}
            </div>
            <Input
              value={inviteMessage}
              onChange={(e) => setInviteMessage(e.target.value)}
              placeholder={t('userPicker.optionalMessage')}
              className="bg-gray-700 border-gray-600 text-white placeholder-gray-400 mb-3"
            />
            <div className="flex space-x-2">
              <Button
                size="sm"
                onClick={handleInviteUser}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Mail className="w-4 h-4 mr-1" />
                Send Invite
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowInviteForm(false)}
                className="border-gray-600 text-gray-300"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Access warning dialog */}
        {showAccessWarning && pendingUser && (
          <div className="absolute top-full left-0 right-0 mt-1 p-4 bg-yellow-900 border border-yellow-600 rounded-lg shadow-lg z-10">
            <div className="text-sm text-yellow-100 mb-3">
              <div className="font-medium mb-1">⚠️ Access Warning</div>
              <div>{pendingUser.accessWarning}</div>
            </div>
            <div className="flex space-x-2">
              <Button
                size="sm"
                onClick={confirmUserSelection}
                className="bg-yellow-600 hover:bg-yellow-700 text-yellow-100"
              >
                <Check className="w-4 h-4 mr-1" />
                Assign Anyway
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={cancelUserSelection}
                className="border-yellow-600 text-yellow-100"
              >
                <X className="w-4 h-4 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
