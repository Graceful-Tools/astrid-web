"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Users, Plus, MoreVertical, Mail, UserCheck, UserMinus, Crown, Shield, User as UserIcon, Eye, X } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { UserLink } from "@/components/user-link"
import type { TaskList, User } from "@/types/task"

// New unified member type (matching quote_vote approach)
interface Member {
  id: string
  user_id?: string
  list_id: string
  role: string
  email: string
  name?: string
  image?: string | null
  isAIAgent?: boolean
  created_at: Date
  updated_at?: Date
  type: 'member' | 'invite'
}

interface ListMembersManagerProps {
  list: TaskList
  currentUser: User
  onUpdate?: (updatedList: TaskList & { _userLeft?: boolean }) => void
}

export function ListMembersManager({ list, currentUser, onUpdate }: ListMembersManagerProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(false)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member")
  const { toast } = useToast()

  // Check if current user is admin (owner or has admin role)
  const isAdmin = list.ownerId === currentUser.id

  const loadMembers = useCallback(async () => {
    try {
      setLoading(true)
      
      const response = await fetch(`/api/lists/${list.id}/members`, {
        credentials: 'include'
      })
      
      if (!response.ok) {
        if (response.status === 403) {
          // No permission to view members - silently return
          return
        }
        throw new Error('Failed to fetch members')
      }
      
      const data = await response.json()
      setMembers(data.members || [])
    } catch (error) {
      console.error("Error loading members:", error)
      toast({
        title: "Error",
        description: "Failed to load list members",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [list.id, toast])

  useEffect(() => {
    loadMembers()
  }, [list.id, loadMembers])

  // Check if current user can leave the list
  const canCurrentUserLeave = () => {
    const currentUserMember = members.find(m => m.user_id === currentUser.id)
    if (!currentUserMember) return false

    // Check if user is an admin (either has admin role or is the owner)
    const isCurrentUserAdmin = currentUserMember.role === 'admin' || list.ownerId === currentUser.id

    // If user is not an admin, they can always leave
    if (!isCurrentUserAdmin) return true

    // If user is an admin, check if they're the last admin
    const adminMembers = members.filter(m => m.role === 'admin' && m.type === 'member')

    // Count owner as admin if they're not already counted in the members table
    const ownerIsAdminMember = members.some(m => m.user_id === list.ownerId && m.role === 'admin')
    const totalAdmins = adminMembers.length + (list.ownerId && !ownerIsAdminMember ? 1 : 0)

    // Can leave if there are other admins
    return totalAdmins > 1
  }

  const handleInviteUser = async () => {
    if (!inviteEmail.trim()) {
      toast({
        title: "Error",
        description: "Please enter an email address",
        variant: "destructive",
      })
      return
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(inviteEmail)) {
      toast({
        title: "Error",
        description: "Please enter a valid email address",
        variant: "destructive",
      })
      return
    }

    const tempMemberId = `temp-${Date.now()}`
    const newMember: Member = {
      id: tempMemberId,
      list_id: list.id,
      email: inviteEmail.trim(),
      role: inviteRole,
      created_at: new Date(),
      type: 'invite',
      // No user_id or name since this is an invite
    }

    try {
      setLoading(true)
      
      // 1. OPTIMISTIC UPDATE: Add member immediately to UI
      setMembers(prevMembers => [...prevMembers, newMember])
      setInviteEmail("")
      setShowInviteForm(false)
      
      // Show optimistic success immediately
      toast({
        title: "Success",
        description: "Invitation sent",
      })
      
      // 2. API CALL: Send the actual request
      const response = await fetch(`/api/lists/${list.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to add member")
      }

      // 3. SYNC: Replace temp member with real data
      await loadMembers()
    } catch (error) {
      console.error("Error adding member:", error)
      
      // 4. ROLLBACK: Remove the optimistic member on error
      setMembers(prevMembers => 
        prevMembers.filter(member => member.id !== tempMemberId)
      )
      
      // Restore form state
      setInviteEmail(inviteEmail.trim())
      
      toast({
        title: "Error", 
        description: error instanceof Error ? error.message : "Failed to add member",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveMember = async (memberIdOrEmail: string, isInvitation: boolean = false) => {
    const member = members.find(m => 
      (m.user_id && m.user_id === memberIdOrEmail) || 
      m.email === memberIdOrEmail
    )
    
    if (!member) {
      toast({
        title: "Error",
        description: "Member not found",
        variant: "destructive",
      })
      return
    }

    try {
      setLoading(true)
      
      // 1. OPTIMISTIC UPDATE: Remove member immediately from UI
      setMembers(prevMembers => prevMembers.filter(m => {
        if (m.user_id && memberIdOrEmail && !isNaN(Number(memberIdOrEmail))) {
          return m.user_id !== memberIdOrEmail
        }
        return m.email !== memberIdOrEmail
      }))

      // Show optimistic success immediately
      toast({
        title: "Success",
        description: member.type === 'invite' ? 'Invitation cancelled' : 'Member removed successfully',
      })

      // 2. API CALL: Send the actual request
      const response = await fetch(`/api/lists/${list.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          ...(member.type === 'invite' 
            ? { email: member.email, isInvitation: true }
            : { memberId: memberIdOrEmail }
          )
        }),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to remove member")
      }
    } catch (error) {
      console.error("Error removing member:", error)
      
      // 3. ROLLBACK: Restore the member on error
      setMembers(prevMembers => [...prevMembers, member])
      
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to remove member",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateMemberRole = async (userId: string, newRole: "admin" | "member") => {
    const targetMember = members.find(member => member.user_id === userId)
    if (!targetMember) {
      toast({
        title: "Error",
        description: "Member not found",
        variant: "destructive",
      })
      return
    }

    const oldRole = targetMember.role

    try {
      setLoading(true)
      
      // 1. OPTIMISTIC UPDATE: Update role immediately in UI
      setMembers(prevMembers => prevMembers.map(member => 
        member.user_id === userId 
          ? { ...member, role: newRole }
          : member
      ))

      // Show optimistic success immediately
      toast({
        title: "Success",
        description: `Member role updated to ${newRole}`,
      })
      
      // 2. API CALL: Send the actual request
      const response = await fetch(`/api/lists/${list.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: userId, role: newRole }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to update member role")
      }
    } catch (error) {
      console.error("Error updating member role:", error)
      
      // 3. ROLLBACK: Restore the original role on error
      setMembers(prevMembers => prevMembers.map(member => 
        member.user_id === userId 
          ? { ...member, role: oldRole }
          : member
      ))
      
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update member role",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleLeaveList = async () => {
    const currentUserMember = members.find(m => m.user_id === currentUser.id)
    
    try {
      setLoading(true)
      
      // 1. OPTIMISTIC UPDATE: Remove current user from members immediately
      if (currentUserMember) {
        setMembers(prevMembers => 
          prevMembers.filter(member => member.user_id !== currentUser.id)
        )
      }

      // Show optimistic success immediately
      toast({
        title: "Success",
        description: "You have left the list",
      })

      // Immediately trigger parent update to redirect user away from list
      if (onUpdate) {
        onUpdate({ ...list, _userLeft: true })
      }
      
      // 2. API CALL: Send the actual request
      const response = await fetch(`/api/lists/${list.id}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to leave list")
      }
    } catch (error) {
      console.error("Error leaving list:", error)
      
      // 3. ROLLBACK: Restore the current user member on error
      if (currentUserMember) {
        setMembers(prevMembers => [...prevMembers, currentUserMember])
      }
      
      // Reset the parent state since we failed to leave
      if (onUpdate) {
        onUpdate({ ...list, _userLeft: false })
      }
      
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to leave list",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateInviteRole = async (email: string, newRole: "admin" | "member") => {
    const targetInvite = members.find(member => member.email === email && member.type === 'invite')
    if (!targetInvite) {
      toast({
        title: "Error",
        description: "Invitation not found",
        variant: "destructive",
      })
      return
    }

    const oldRole = targetInvite.role

    try {
      setLoading(true)
      
      // 1. OPTIMISTIC UPDATE: Update role immediately in UI
      setMembers(prevMembers => prevMembers.map(member => 
        member.email === email && member.type === 'invite'
          ? { ...member, role: newRole }
          : member
      ))

      // Show optimistic success immediately
      toast({
        title: "Success",
        description: `Invitation role updated to ${newRole}`,
      })

      // 2. API CALL: Send the actual request
      const response = await fetch(`/api/lists/${list.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: newRole, isInvitation: true }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to update invitation role")
      }
    } catch (error) {
      console.error("Error updating invitation role:", error)
      
      // 3. ROLLBACK: Restore the original role on error
      setMembers(prevMembers => prevMembers.map(member => 
        member.email === email && member.type === 'invite'
          ? { ...member, role: oldRole }
          : member
      ))
      
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update invitation role",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }


  const getRoleIcon = (role: string) => {
    switch (role) {
      case "owner":
        return <Crown className="w-4 h-4 text-yellow-500" />
      case "admin":
        return <Shield className="w-4 h-4 text-blue-600 dark:text-blue-500" />
      case "member":
        return <UserIcon className="w-4 h-4 text-green-500" />
      case "viewer":
        return <Eye className="w-4 h-4 theme-text-muted" />
      default:
        return null
    }
  }

  const getRoleBadgeVariant = (role: string): "default" | "secondary" | "outline" => {
    switch (role) {
      case "owner":
        return "default"
      case "admin":
        return "secondary"
      case "member":
        return "outline"
      case "viewer":
        return "outline"
      default:
        return "outline"
    }
  }

  return (
    <div className="theme-bg-secondary rounded-lg p-2 theme-border border">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <Users className="w-4 h-4 theme-text-muted" />
          <Label className="text-sm theme-text-muted">
            Members ({members.length})
          </Label>
        </div>
        {isAdmin && (
          <Button
            onClick={() => setShowInviteForm(!showInviteForm)}
            size="sm"
            variant="ghost"
            className="theme-text-muted hover:theme-text-primary p-1"
          >
            <Plus className="w-4 h-4" />
          </Button>
        )}
      </div>

      {showInviteForm && (
        <div className="mb-4 p-3 theme-bg-tertiary rounded-lg theme-border border">
          <h4 className="font-medium mb-3 theme-text-primary">Invite New Member</h4>
          <div className="space-y-3">
            <div>
              <Label htmlFor="invite-email" className="text-sm theme-text-muted">Email Address</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Enter email address"
                className="theme-input theme-border-input border theme-text-primary"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="invite-role" className="text-sm theme-text-muted">Role</Label>
              <Select value={inviteRole} onValueChange={(value: "admin" | "member") => setInviteRole(value)}>
                <SelectTrigger className="theme-input theme-border-input border theme-text-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[10100]">
                  <SelectItem value="admin">Admin - Can manage list settings and members</SelectItem>
                  <SelectItem value="member">Member - Can add, edit, and manage tasks</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex space-x-2">
              <Button onClick={handleInviteUser} disabled={loading} size="sm">
                <Mail className="w-4 h-4 mr-2" />
                Send Invitation
              </Button>
              <Button variant="outline" onClick={() => setShowInviteForm(false)} size="sm">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {members.length === 0 ? (
          <div className="text-center py-6 theme-text-muted">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No members yet</p>
            {isAdmin && (
              <p className="text-xs">Invite people to collaborate on this list</p>
            )}
          </div>
        ) : (
          <>
            {members.map((member) => (
            <div key={member.user_id || member.email} className="flex flex-wrap items-center justify-between gap-2 p-2 theme-bg-tertiary rounded theme-border border">
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                {/* For active members, use UserLink. For pending invites, show non-clickable */}
                {member.type === 'member' && member.user_id ? (
                  <UserLink
                    user={{
                      id: member.user_id,
                      name: member.name || null,
                      email: member.email,
                      image: member.image || null,
                      createdAt: member.created_at,
                    }}
                    showAvatar={true}
                    avatarSize="sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm truncate">
                          {member.name || member.email}
                        </span>
                        {member.isAIAgent && (
                          <Badge variant="outline" className="text-xs px-1 py-0 text-purple-400 border-purple-400 shrink-0">
                            AI
                          </Badge>
                        )}
                      </div>
                      {member.name && !member.isAIAgent && (
                        <div className="text-xs theme-text-muted truncate">{member.email}</div>
                      )}
                    </div>
                  </UserLink>
                ) : (
                  <>
                    <Avatar className={`w-6 h-6 shrink-0 ${member.type === 'invite' ? 'opacity-60' : ''}`}>
                      <AvatarImage src="/placeholder.svg" />
                      <AvatarFallback className="text-xs">
                        {member.name?.charAt(0) || member.email.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm theme-text-primary truncate">
                          {member.name || member.email}
                        </span>
                        {member.type === 'invite' && (
                          <Badge variant="outline" className="text-xs px-1 py-0 text-yellow-400 border-yellow-400 shrink-0">
                            Pending
                          </Badge>
                        )}
                      </div>
                      {member.name && (
                        <div className="text-xs theme-text-muted truncate">{member.email}</div>
                      )}
                    </div>
                  </>
                )}
              </div>
              
              <div className="flex items-center space-x-2 shrink-0">
                <div className="flex items-center space-x-1 text-xs theme-text-muted">
                  {getRoleIcon(member.role)}
                  <span className="capitalize">{member.role}</span>
                </div>
                
                {(isAdmin || member.user_id === currentUser.id) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="theme-text-muted hover:theme-text-primary p-1">
                        <MoreVertical className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-[10100]">
                      {isAdmin && member.user_id !== currentUser.id && (
                        <>
                          {member.type === 'member' && (
                            <>
                              {member.role !== "admin" && (
                                <DropdownMenuItem onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleUpdateMemberRole(member.user_id!, "admin")
                                }}>
                                  <Shield className="w-4 h-4 mr-2" />
                                  Make Admin
                                </DropdownMenuItem>
                              )}
                              {member.role !== "member" && (
                                <DropdownMenuItem onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleUpdateMemberRole(member.user_id!, "member")
                                }}>
                                  <UserCheck className="w-4 h-4 mr-2" />
                                  Make Member
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                          {member.type === 'invite' && (
                            <>
                              {member.role !== "admin" && (
                                <DropdownMenuItem onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleUpdateInviteRole(member.email, "admin")
                                }}>
                                  <Shield className="w-4 h-4 mr-2" />
                                  Make Admin
                                </DropdownMenuItem>
                              )}
                              {member.role !== "member" && (
                                <DropdownMenuItem onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleUpdateInviteRole(member.email, "member")
                                }}>
                                  <UserCheck className="w-4 h-4 mr-2" />
                                  Make Member
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              handleRemoveMember(member.user_id || member.email)
                            }}
                            className="text-red-400 hover:text-red-300"
                          >
                            <UserMinus className="w-4 h-4 mr-2" />
                            {member.type === 'invite' ? 'Cancel' : 'Remove'}
                          </DropdownMenuItem>
                        </>
                      )}
                      
                      {member.user_id === currentUser.id && canCurrentUserLeave() && (
                        <DropdownMenuItem 
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleLeaveList()
                          }}
                          className="text-red-400 hover:text-red-300"
                        >
                          <UserMinus className="w-4 h-4 mr-2" />
                          Leave
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ))}
          </>
        )}
      </div>

      {list.privacy === "SHARED" && (
        <div className="mt-4 p-3 bg-blue-900/20 rounded-lg">
          <h4 className="font-medium text-blue-600 dark:text-blue-200 mb-2 text-sm">
            Permission Levels
          </h4>
          <div className="space-y-1 text-xs text-blue-600 dark:text-blue-300">
            <div className="flex items-center space-x-2">
              <Crown className="w-3 h-3" />
              <span><strong>Owner:</strong> Full control over the list</span>
            </div>
            <div className="flex items-center space-x-2">
              <Shield className="w-3 h-3" />
              <span><strong>Admin:</strong> Can manage list settings and members</span>
            </div>
            <div className="flex items-center space-x-2">
              <UserIcon className="w-3 h-3" />
              <span><strong>Member:</strong> Can add, edit, and manage tasks</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}