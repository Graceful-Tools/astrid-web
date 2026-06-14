"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/hooks/use-toast"
import { Crown, Shield, User as UserIcon, MoreVertical, Plus, Loader2 } from "lucide-react"

type Role = "admin" | "member"

interface ProjectMemberRow {
  id: string
  user_id?: string
  role: string
  email: string
  name?: string | null
  image?: string | null
  isOwner?: boolean
  type: "member" | "invite"
}

interface ProjectSharingManagerProps {
  projectId: string
  /** Reflects the current user's role in the project (from the GET response). */
  onRoleResolved?: (role: "owner" | "admin" | "member") => void
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function roleIcon(role: string) {
  switch (role) {
    case "owner":
      return <Crown className="w-3.5 h-3.5 text-yellow-500" />
    case "admin":
      return <Shield className="w-3.5 h-3.5 text-blue-500" />
    default:
      return <UserIcon className="w-3.5 h-3.5 text-green-500" />
  }
}

/**
 * Project sharing UI — invite people to a project (board #3). Mirrors the list
 * members manager's UX but talks to the project endpoints, which reuse the
 * generic Invitation system: existing accounts join immediately, unknown
 * emails get a pending invite + email. Member ops hit /members/:userId; invite
 * ops hit the collection route with { isInvitation: true }.
 */
export function ProjectSharingManager({ projectId, onRoleResolved }: ProjectSharingManagerProps) {
  const { toast } = useToast()
  const [members, setMembers] = useState<ProjectMemberRow[]>([])
  const [userRole, setUserRole] = useState<"owner" | "admin" | "member">("member")
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<Role>("member")
  const [submitting, setSubmitting] = useState(false)

  const canManage = userRole === "owner" || userRole === "admin"
  const canGrantAdmin = userRole === "owner"

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/members`)
      if (!res.ok) return
      const data = await res.json()
      setMembers(data.members ?? [])
      if (data.user_role) {
        setUserRole(data.user_role)
        onRoleResolved?.(data.user_role)
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }, [projectId, onRoleResolved])

  useEffect(() => {
    load()
  }, [load])

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      toast({ title: "Enter a valid email", variant: "destructive" })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data.error || "Failed to share project", variant: "destructive" })
        return
      }
      setInviteEmail("")
      setInviteRole("member")
      toast({ title: data.invited ? "Invitation sent" : "Member added" })
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  const changeRole = async (row: ProjectMemberRow, role: Role) => {
    const url =
      row.type === "invite"
        ? `/api/projects/${projectId}/members`
        : `/api/projects/${projectId}/members/${row.user_id}`
    const body =
      row.type === "invite"
        ? { email: row.email, isInvitation: true, role }
        : { role }
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: data.error || "Failed to update role", variant: "destructive" })
      return
    }
    await load()
  }

  const remove = async (row: ProjectMemberRow) => {
    const res =
      row.type === "invite"
        ? await fetch(`/api/projects/${projectId}/members`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: row.email, isInvitation: true }),
          })
        : await fetch(`/api/projects/${projectId}/members/${row.user_id}`, { method: "DELETE" })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: data.error || "Failed to remove", variant: "destructive" })
      return
    }
    toast({ title: row.type === "invite" ? "Invitation cancelled" : "Member removed" })
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 theme-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex items-center gap-2">
          <Input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="Invite by email"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleInvite()
            }}
          />
          <Select value={inviteRole} onValueChange={(v: Role) => setInviteRole(v)}>
            <SelectTrigger className="w-28 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              {canGrantAdmin && <SelectItem value="admin">Admin</SelectItem>}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleInvite} disabled={submitting} className="shrink-0">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
      )}

      <div className="space-y-1">
        {members.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:theme-bg-hover"
            data-testid={`project-member-${m.type}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Avatar className={`w-7 h-7 ${m.type === "invite" ? "opacity-60" : ""}`}>
                {m.image && <AvatarImage src={m.image} alt={m.name || m.email} />}
                <AvatarFallback>{(m.name || m.email || "?").charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-sm theme-text-primary">{m.name || m.email}</div>
                {m.name && <div className="truncate text-xs theme-text-muted">{m.email}</div>}
              </div>
              {m.type === "invite" && (
                <Badge variant="outline" className="text-yellow-500 border-yellow-500 shrink-0">
                  Pending
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="flex items-center gap-1 text-xs theme-text-muted capitalize">
                {roleIcon(m.role)}
                {m.role}
              </span>
              {canManage && !m.isOwner && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {m.role !== "admin" && canGrantAdmin && (
                      <DropdownMenuItem onClick={() => changeRole(m, "admin")}>Make admin</DropdownMenuItem>
                    )}
                    {m.role === "admin" && canGrantAdmin && (
                      <DropdownMenuItem onClick={() => changeRole(m, "member")}>Make member</DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="text-red-500" onClick={() => remove(m)}>
                      {m.type === "invite" ? "Cancel invite" : "Remove"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
