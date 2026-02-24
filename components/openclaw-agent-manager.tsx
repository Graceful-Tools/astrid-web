"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import {
  Plus,
  Copy,
  Check,
  Trash2,
  AlertTriangle,
  Loader2,
  Camera,
} from "lucide-react"

interface OpenClawAgent {
  id: string
  email: string
  name: string
  image: string | null
  agentName: string
  status: "active" | "idle"
  registeredAt: string
  lastActiveAt: string | null
  oauthClientId: string | null
}

interface RegistrationResult {
  agent: { id: string; email: string; name: string }
  oauth: { clientId: string; clientSecret: string; scopes: string[] }
  config: { sseEndpoint: string; apiBase: string; tokenEndpoint: string }
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,30}[a-z0-9]$/

export function OpenClawAgentManager() {
  const [agents, setAgents] = useState<OpenClawAgent[]>([])
  const [loading, setLoading] = useState(true)

  // Registration
  const [registerOpen, setRegisterOpen] = useState(false)
  const [agentName, setAgentName] = useState("")
  const [registering, setRegistering] = useState(false)

  // Credentials (shown once)
  const [credentials, setCredentials] = useState<RegistrationResult | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<OpenClawAgent | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Profile photo upload
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null)

  const fetchAgents = async () => {
    try {
      const res = await fetch("/api/v1/openclaw/agents")
      if (res.ok) {
        const data = await res.json()
        setAgents(data.agents)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAgents()
  }, [])

  const namePreview = agentName.toLowerCase().trim()
  const isNameValid = namePreview.length >= 2 && NAME_PATTERN.test(namePreview)

  const handleRegister = async () => {
    if (!isNameValid) return
    setRegistering(true)
    try {
      const res = await fetch("/api/v1/openclaw/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: namePreview }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || "Registration failed")
        return
      }
      const data: RegistrationResult = await res.json()
      setRegisterOpen(false)
      setAgentName("")
      setCredentials(data)
      await fetchAgents()
      toast.success(`Agent ${data.agent.email} created`)
    } catch {
      toast.error("Registration failed")
    } finally {
      setRegistering(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/v1/openclaw/agents/${deleteTarget.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        toast.error("Failed to remove agent")
        return
      }
      setAgents(prev => prev.filter(a => a.id !== deleteTarget.id))
      setDeleteTarget(null)
      toast.success("Agent removed")
    } catch {
      toast.error("Failed to remove agent")
    } finally {
      setDeleting(false)
    }
  }

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      // Fallback for older browsers
      const el = document.createElement("textarea")
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    }
  }

  const handlePhotoClick = (agentId: string) => {
    setUploadingPhotoFor(agentId)
    fileInputRef.current?.click()
  }

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !uploadingPhotoFor) return

    // Reset input so same file can be re-selected
    event.target.value = ""

    const agentId = uploadingPhotoFor
    setUploadingPhotoFor(null)

    try {
      // Upload file to get a URL
      const formData = new FormData()
      formData.append("file", file)

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!uploadRes.ok) {
        throw new Error("Failed to upload image")
      }

      const { url } = await uploadRes.json()

      // Update agent profile photo
      const patchRes = await fetch(`/api/v1/openclaw/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: url }),
      })

      if (!patchRes.ok) {
        throw new Error("Failed to update profile photo")
      }

      const { image: newImage } = await patchRes.json()

      // Update local state
      setAgents(prev =>
        prev.map(a => a.id === agentId ? { ...a, image: newImage } : a)
      )

      toast.success("Profile photo updated")
    } catch {
      toast.error("Failed to update profile photo")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin theme-text-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Hidden file input for photo uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handlePhotoUpload}
        className="hidden"
      />

      {/* Agent list */}
      {agents.length > 0 && (
        <div className="space-y-2">
          {agents.map(agent => (
            <div
              key={agent.id}
              className="flex items-center justify-between p-3 theme-bg-tertiary rounded-lg"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => handlePhotoClick(agent.id)}
                  className="relative group shrink-0"
                  title="Change profile photo"
                >
                  <Avatar className="w-9 h-9">
                    <AvatarImage
                      src={agent.image || "/images/ai-agents/openclaw.svg"}
                      alt={agent.name || agent.email}
                    />
                    <AvatarFallback>
                      {agent.agentName?.substring(0, 2).toUpperCase() || "OC"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="w-4 h-4 text-white" />
                  </div>
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono theme-text-primary truncate">
                      {agent.email}
                    </code>
                    <Badge
                      variant={agent.status === "active" ? "default" : "secondary"}
                      className={
                        agent.status === "active"
                          ? "bg-green-600 hover:bg-green-700 text-white text-xs"
                          : "text-xs"
                      }
                    >
                      {agent.status === "active" ? "Active" : "Idle"}
                    </Badge>
                  </div>
                  <p className="text-xs theme-text-muted mt-0.5">
                    Registered {new Date(agent.registeredAt).toLocaleDateString()}
                    {agent.lastActiveAt && (
                      <> &middot; Last active {new Date(agent.lastActiveAt).toLocaleDateString()}</>
                    )}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteTarget(agent)}
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {agents.length === 0 && (
        <p className="text-sm theme-text-muted text-center py-4">
          No OpenClaw agents connected. Register one to get started.
        </p>
      )}

      {/* Register button */}
      <Button
        variant="outline"
        onClick={() => setRegisterOpen(true)}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        Connect Agent
      </Button>

      {/* Registration dialog */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="theme-bg-secondary theme-border">
          <DialogHeader>
            <DialogTitle className="theme-text-primary">
              Register OpenClaw Agent
            </DialogTitle>
            <DialogDescription className="theme-text-muted">
              Create an AI agent identity with OAuth credentials for the OpenClaw protocol.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="agent-name" className="theme-text-secondary">
                Agent Name
              </Label>
              <Input
                id="agent-name"
                value={agentName}
                onChange={e => setAgentName(e.target.value.toLowerCase())}
                placeholder="buddy"
                className="theme-input theme-text-primary mt-1 font-mono"
                autoFocus
              />
              <div className="mt-2 text-sm">
                {namePreview.length > 0 ? (
                  isNameValid ? (
                    <span className="text-green-500">
                      {namePreview}.oc@astrid.cc
                    </span>
                  ) : (
                    <span className="text-red-500">
                      Invalid name. Use 2-32 lowercase alphanumeric characters, dots, hyphens, or underscores.
                    </span>
                  )
                ) : (
                  <span className="theme-text-muted">
                    Choose a name for your agent (e.g., buddy, helper, dev-bot)
                  </span>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setRegisterOpen(false); setAgentName("") }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRegister}
              disabled={!isNameValid || registering}
            >
              {registering ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Registering...
                </>
              ) : (
                "Create Agent"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credentials dialog (one-time display) */}
      <Dialog open={!!credentials} onOpenChange={() => setCredentials(null)}>
        <DialogContent className="theme-bg-secondary theme-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="theme-text-primary flex items-center gap-2">
              <Check className="w-5 h-5 text-green-500" />
              Agent Created
            </DialogTitle>
            <DialogDescription className="theme-text-muted">
              Save these credentials now. The client secret will not be shown again.
            </DialogDescription>
          </DialogHeader>

          {credentials && (
            <div className="space-y-3">
              <div className="p-3 bg-red-900/20 border border-red-600/30 rounded-lg">
                <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
                  <AlertTriangle className="w-4 h-4" />
                  Save these credentials now!
                </div>
              </div>

              <CredentialField
                label="Agent Email"
                value={credentials.agent.email}
                field="email"
                copiedField={copiedField}
                onCopy={copyToClipboard}
              />
              <CredentialField
                label="Client ID"
                value={credentials.oauth.clientId}
                field="clientId"
                copiedField={copiedField}
                onCopy={copyToClipboard}
              />
              <CredentialField
                label="Client Secret"
                value={credentials.oauth.clientSecret}
                field="clientSecret"
                copiedField={copiedField}
                onCopy={copyToClipboard}
                sensitive
              />
              <CredentialField
                label="Token Endpoint"
                value={credentials.config.tokenEndpoint}
                field="tokenEndpoint"
                copiedField={copiedField}
                onCopy={copyToClipboard}
              />
              <CredentialField
                label="API Base"
                value={credentials.config.apiBase}
                field="apiBase"
                copiedField={copiedField}
                onCopy={copyToClipboard}
              />
              <CredentialField
                label="SSE Endpoint"
                value={credentials.config.sseEndpoint}
                field="sseEndpoint"
                copiedField={copiedField}
                onCopy={copyToClipboard}
              />
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setCredentials(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="theme-bg-secondary theme-border">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Remove Agent
            </DialogTitle>
            <DialogDescription className="theme-text-muted">
              This will permanently delete <strong>{deleteTarget?.email}</strong> and
              revoke its OAuth credentials. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Removing..." : "Remove Agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CredentialField({
  label,
  value,
  field,
  copiedField,
  onCopy,
  sensitive,
}: {
  label: string
  value: string
  field: string
  copiedField: string | null
  onCopy: (text: string, field: string) => void
  sensitive?: boolean
}) {
  return (
    <div>
      <Label className="text-xs theme-text-muted">{label}</Label>
      <div className="flex items-center gap-2 mt-0.5">
        <code
          className={`flex-1 text-xs font-mono p-2 theme-bg-tertiary rounded truncate ${
            sensitive ? "text-red-400" : "theme-text-primary"
          }`}
        >
          {value}
        </code>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => onCopy(value, field)}
        >
          {copiedField === field ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
