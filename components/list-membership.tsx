"use client"

import { useTranslations } from '@/lib/i18n/client'
import { BRAND } from '@/lib/brand/config'
import { unwrapList } from '@/lib/v1-response'
import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ListMembersManager } from "./list-members-manager"
import type { TaskList, User } from "../types/task"
import { Globe, Lock, Bot, Sparkles, ExternalLink } from "lucide-react"
import { getAllListMembers } from "@/lib/list-member-utils"
import { UserLink } from "./user-link"
import Link from "next/link"
import { canUserDeleteList } from "@/lib/list-permissions"

// AI agent type from the database
interface AIAgent {
  id: string
  name: string
  email: string
  image: string | null
  isAIAgent: boolean
  aiAgentType: string | null
}

interface ListMembershipProps {
  list: TaskList
  currentUser: User
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
  onLeave?: (list: TaskList, isOwnerLeaving?: boolean) => void
}

export function ListMembership({
  list,
  currentUser,
  canEditSettings,
  onUpdate,
  onLeave
}: ListMembershipProps) {

  const { t } = useTranslations()
  // AI Coding Agent state
  const [availableAiAgents, setAvailableAiAgents] = useState<AIAgent[]>([])
  const [loadingAiProviders, setLoadingAiProviders] = useState(false)
  const [removingAgents, setRemovingAgents] = useState<Set<string>>(new Set())
  const [isGitHubConnected, setIsGitHubConnected] = useState(false)

  // Load AI agents on mount - fetch actual agents from database based on user's API keys
  useEffect(() => {
    const loadAiAgents = async () => {
      try {
        setLoadingAiProviders(true)

        // Check GitHub status first
        const githubResponse = await fetch('/api/v1/github/status')
        if (githubResponse.ok) {
          const githubData = await githubResponse.json()
          setIsGitHubConnected(githubData.isGitHubConnected)
        }

        // Fetch actual AI agents from database (based on user's configured API keys)
        const agentsResponse = await fetch('/api/v1/users/search?includeAIAgents=true')
        if (agentsResponse.ok) {
          const agentsData = await agentsResponse.json()
          // Filter to only AI agents
          const aiAgents = (agentsData.users || []).filter((u: AIAgent) => u.isAIAgent)
          setAvailableAiAgents(aiAgents)
        }
      } catch (error) {
        console.error('Error loading AI agents:', error)
      } finally {
        setLoadingAiProviders(false)
      }
    }

    loadAiAgents()
  }, [])

  // Check if an AI agent is already a member of this list
  const isAgentMember = (agentEmail: string) => {
    // Use the same utility function that other components use to get all members
    const allMembers = getAllListMembers(list)
    return allMembers.some(member => member.email === agentEmail)
  }

  const handleAddCodingAgent = async (agent: AIAgent) => {
    try {
      // Add agent to list members
      const response = await fetch(`/api/v1/lists/${list.id}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: agent.email,
          role: 'member'
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        // If agent is already a member (409), treat as success for UI purposes
        if (response.status === 409) {
          console.log(`Agent ${agent.email} is already a member`)
        } else {
          console.warn(`Failed to add ${agent.email} to list:`, errorText)
          return false
        }
      } else {
        console.log(`✅ Added ${agent.email} to list`)
      }

      // Update the list settings to mark this agent as enabled
      const currentEnabledAgents = Array.isArray(list.aiAgentsEnabled) ? list.aiAgentsEnabled as string[] : []
      const newEnabledAgents = [...currentEnabledAgents, agent.aiAgentType || agent.id]

      // Fetch fresh list data to get updated members
      const listResponse = await fetch(`/api/v1/lists/${list.id}`)
      if (listResponse.ok) {
        const freshList = unwrapList<TaskList>(await listResponse.json())
        // Fall back to the list we already hold rather than spreading a null.
        onUpdate({ ...(freshList ?? list), aiAgentsEnabled: newEnabledAgents })
      } else {
        // Fallback to old behavior if fetch fails
        onUpdate({ ...list, aiAgentsEnabled: newEnabledAgents })
      }

      return true
    } catch (error) {
      console.error(`Error adding AI agent ${agent.name}:`, error)
      return false
    }
  }

  const handleRemoveCodingAgent = async (agent: AIAgent) => {
    // Set loading state
    setRemovingAgents(prev => new Set([...prev, agent.id]))

    try {
      // Find the agent directly by looking at current list members
      const allMembers = getAllListMembers(list)
      const memberRecord = allMembers.find(member => member.email === agent.email)

      if (!memberRecord?.id) {
        console.warn(`Agent ${agent.email} not found in current list members`)
        // Update UI anyway since the agent should be removed from the enabled list
        const currentEnabledAgents = Array.isArray(list.aiAgentsEnabled) ? list.aiAgentsEnabled as string[] : []
        const newEnabledAgents = currentEnabledAgents.filter(id => id !== agent.aiAgentType && id !== agent.id)
        onUpdate({ ...list, aiAgentsEnabled: newEnabledAgents })
        return false
      }

      // Remove the agent from the list members. Always a real member here
      // (`isInvitation: false` on the legacy call it replaces) — the agent was
      // just looked up in getAllListMembers, so it has a userId to address.
      // (Task dc143ab2)
      const response = await fetch(`/api/v1/lists/${list.id}/members/${memberRecord.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Failed to remove ${agent.email} from list:`, response.status, errorText)
        return false
      }

      // Update the list settings to remove this agent from enabled
      const currentEnabledAgents = Array.isArray(list.aiAgentsEnabled) ? list.aiAgentsEnabled as string[] : []
      const newEnabledAgents = currentEnabledAgents.filter(id => id !== agent.aiAgentType && id !== agent.id)

      // Fetch fresh list data to get updated members
      const listResponse = await fetch(`/api/v1/lists/${list.id}`)
      if (listResponse.ok) {
        const freshList = unwrapList<TaskList>(await listResponse.json())
        // Fall back to the list we already hold rather than spreading a null.
        onUpdate({ ...(freshList ?? list), aiAgentsEnabled: newEnabledAgents })
      } else {
        // Fallback to old behavior if fetch fails
        onUpdate({ ...list, aiAgentsEnabled: newEnabledAgents })
      }

      return true
    } catch (error) {
      console.error(`Error removing AI agent ${agent.name}:`, error)
      return false
    } finally {
      // Clear loading state
      setRemovingAgents(prev => {
        const newSet = new Set(prev)
        newSet.delete(agent.id)
        return newSet
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* Members Management */}
      <div>
        <h3 className="text-sm font-medium theme-text-primary mb-3">{t('lists.members')}</h3>
        <ListMembersManager
          list={list}
          currentUser={currentUser}
          onUpdate={onUpdate}
          onLeave={onLeave}
        />
      </div>

      {/* AI Agents Section - Shown when user has AI agents available */}
      {canEditSettings && availableAiAgents.length > 0 && (
        <div className="border-t theme-border pt-4">
          <div className="space-y-4">
            <div className="flex items-center space-x-2 mb-3">
              <Bot className="w-4 h-4 text-purple-600" />
              <Label className="text-sm font-medium theme-text-primary">
                {t(isGitHubConnected ? 'lists.membershipPanel.aiCodingAgents' : 'lists.membershipPanel.aiAgents')}
              </Label>
            </div>

            <div className="space-y-3">
              <Label className="text-sm theme-text-secondary">{t('lists.membershipPanel.availableAgents')}</Label>
              {loadingAiProviders ? (
                <p className="text-xs theme-text-muted">{t('lists.membershipPanel.loadingAgents')}</p>
              ) : (
                availableAiAgents.map((agent) => {
                  const agentDescription = t(
                    isGitHubConnected ? 'lists.membershipPanel.agentForCoding' : 'lists.membershipPanel.agentForTasks',
                    { name: agent.name },
                  )
                  const isAlreadyMember = isAgentMember(agent.email)
                  const isRemoving = removingAgents.has(agent.id)

                  return (
                    <div key={agent.id} className="flex items-center justify-between p-3 border border-theme-surface rounded-lg">
                      <div className="flex items-center space-x-3">
                        {/* AI agents are users - use same UserLink as members */}
                        <UserLink
                          user={{
                            id: agent.id,
                            name: agent.name,
                            email: agent.email,
                            image: agent.image,
                            createdAt: new Date(),
                          }}
                          showAvatar={true}
                          avatarSize="md"
                        >
                          <div className="space-y-1">
                            <div className="text-sm font-medium">{agent.name}</div>
                            <div className="text-xs theme-text-muted">{agentDescription}</div>
                          </div>
                        </UserLink>
                      </div>

                      {isAlreadyMember ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemoveCodingAgent(agent)}
                          disabled={isRemoving}
                          className="text-danger hover:text-danger hover:bg-danger-subtle border-danger disabled:opacity-disabled"
                        >
                          {t(isRemoving ? 'settingsPages.customAgents.remove.removing' : 'lists.membershipPanel.removeAgent')}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddCodingAgent(agent)}
                          className="text-brand hover:text-brand-hover hover:bg-brand-subtle border-brand"
                        >
                          {t('lists.membershipPanel.addAgent')}
                        </Button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Agents Promotion - Shown if NO AI agents configured */}
      {canEditSettings && availableAiAgents.length === 0 && !loadingAiProviders && (
        <div className="border-t theme-border pt-4">
          <div className="flex items-center justify-between p-3 bg-theme-secondary rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 relative flex items-center justify-center bg-agent-bubble rounded-full">
                <Bot className="w-5 h-5 text-purple-600" />
                <Sparkles className="w-3 h-3 text-yellow-500 absolute -top-0.5 -right-0.5" />
              </div>
              <div className="space-y-0.5">
                <div className="text-sm font-medium theme-text-primary">{t('lists.membershipPanel.aiHelpTitle')}</div>
                <Link
                  href="/settings/agents"
                  className="text-xs text-purple-600 hover:text-purple-500 flex items-center gap-1"
                >
                  {t('lists.membershipPanel.addApiKeys')}
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Toggle Options */}
      {canEditSettings && (
        <div className="pt-4 border-t theme-border">
          <div className="space-y-3">
            <Label className="text-sm theme-text-secondary">{t('lists.membershipPanel.privacyLabel')}</Label>
            {list.privacy !== "PUBLIC" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onUpdate({ ...list, privacy: "PUBLIC" })
                }}
                className="w-full text-success hover:text-success hover:bg-success-subtle border-success"
              >
                <Globe className="w-4 h-4 mr-2" />
                {t('lists.membershipPanel.makePublic')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onUpdate({ ...list, privacy: "SHARED" })
                }}
                className="w-full text-warning hover:text-warning hover:bg-warning-subtle border-warning"
              >
                <Lock className="w-4 h-4 mr-2" />
                {t('lists.membershipPanel.makePrivate')}
              </Button>
            )}
            <div className="text-xs theme-text-muted">
              {list.privacy === "PUBLIC"
                ? t('lists.membershipPanel.publicHint')
                : t('lists.membershipPanel.privateHint')
              }
            </div>
          </div>
        </div>
      )}

      {/* Public List Type Toggle - only shown for PUBLIC lists */}
      {canEditSettings && list.privacy === "PUBLIC" && (
        <div className="pt-4 border-t theme-border">
          <div className="space-y-3">
            <Label className="text-sm theme-text-secondary">{t('lists.membershipPanel.publicListType')}</Label>
            {list.publicListType === "collaborative" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onUpdate({ ...list, publicListType: "copy_only" })
                }}
                className="w-full text-warning hover:text-warning hover:bg-warning-subtle border-warning"
              >
                <Lock className="w-4 h-4 mr-2" />
                {t('lists.membershipPanel.makeCopyOnly')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onUpdate({ ...list, publicListType: "collaborative" })
                }}
                className="w-full text-success hover:text-success hover:bg-success-subtle border-success"
              >
                <Globe className="w-4 h-4 mr-2" />
                {t('lists.membershipPanel.makeCollaborative')}
              </Button>
            )}
            <div className="text-xs theme-text-muted">
              {list.publicListType === "collaborative"
                ? t('lists.membershipPanel.collaborativeHint')
                : t('lists.membershipPanel.copyOnlyHint')
              }
            </div>
          </div>
        </div>
      )}

      {/* Leave List Button - for non-owners */}
      {!canEditSettings && onLeave && (
        <div className="border-t theme-border pt-4">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onLeave(list)
            }}
            className="w-full hover:text-danger hover:bg-danger-subtle"
          >
            {t('lists.membershipPanel.leaveList')}
          </Button>
        </div>
      )}

      {/* Owner Leave List Button - with succession planning */}
      {canEditSettings && canUserDeleteList(currentUser, list as never) && onLeave && (
        <div className="border-t theme-border pt-4">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onLeave(list, true) // true indicates owner leaving
            }}
            className="w-full hover:text-warning hover:bg-warning-subtle"
          >
            {t('lists.membershipPanel.transferOwnershipAndLeave')}
          </Button>
        </div>
      )}
    </div>
  )
}