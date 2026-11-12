"use client"

import { useEffect, useRef, useState } from "react"
import { useSharedEditingSession } from "@/hooks/use-editing-session"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { KeyRound, RefreshCw, Smartphone, CheckCircle, X, Pencil, Trash2, Plus, AlertCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useWebAuthn } from "@/hooks/use-webauthn"
import { useTranslations } from "@/lib/i18n/client"

interface Passkey {
  id: string
  name: string | null
  credentialDeviceType: string
  credentialBackedUp: boolean
  createdAt: string
}

/**
 * Passkey management for the account settings page: list, add, rename,
 * and delete WebAuthn passkeys. Self-loads the user's passkeys on mount.
 * Extracted from AccountSettings.tsx (Stage 14 of the god-file refactor).
 */
export function PasskeyManagementSection() {
  const { t } = useTranslations()
  const { toast } = useToast()

  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loadingPasskeys, setLoadingPasskeys] = useState(true)
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null)
  const [editingPasskeyName, setEditingPasskeyName] = useState("")
  // Pending-buffer editor: a hand-off saves the typed name (task 7b60c7c5).
  const session = useSharedEditingSession()
  const renameRef = useRef<{ id: string | null; name: string }>({ id: null, name: "" })

  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null)

  const {
    isSupported: isPasskeySupported,
    isLoading: isPasskeyLoading,
    error: passkeyError,
    registerPasskey,
    clearError: clearPasskeyError,
  } = useWebAuthn()

  const loadPasskeys = async () => {
    try {
      const response = await fetch("/api/auth/webauthn/passkeys")
      if (response.ok) {
        const data = await response.json()
        setPasskeys(data.passkeys || [])
      }
    } catch (error) {
      console.error("Error loading passkeys:", error)
    } finally {
      setLoadingPasskeys(false)
    }
  }

  useEffect(() => {
    loadPasskeys()
  }, [])

  const handleAddPasskey = async () => {
    clearPasskeyError()
    const result = await registerPasskey(undefined, t("passkeyErrors.defaultName"))
    if (result.success) {
      toast({
        title: t("settingsPages.passkeys.toasts.addedTitle"),
        description: t("settingsPages.passkeys.toasts.addedDesc"),
        duration: 3000,
      })
      loadPasskeys()
    } else if (passkeyError) {
      toast({
        title: t("messages.error"),
        description: passkeyError,
        duration: 5000,
      })
    }
  }

  const handleRenamePasskey = async (id: string) => {
    if (!editingPasskeyName.trim()) return

    try {
      const response = await fetch("/api/auth/webauthn/passkeys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: editingPasskeyName.trim() }),
      })

      if (response.ok) {
        toast({
          title: t("settingsPages.passkeys.toasts.renamedTitle"),
          description: t("settingsPages.passkeys.toasts.renamedDesc"),
          duration: 3000,
        })
        if (editingPasskeyId) session.endEditing(`passkey:${editingPasskeyId}`)
        setEditingPasskeyId(null)
        setEditingPasskeyName("")
        loadPasskeys()
      } else {
        const error = await response.json()
        toast({
          title: t("messages.error"),
          description: error.error || t("settingsPages.passkeys.toasts.renameFailed"),
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error renaming passkey:", error)
      toast({
        title: t("messages.error"),
        description: t("settingsPages.passkeys.toasts.renameFailed"),
        duration: 5000,
      })
    }
  }

  // Whichever passkey is open registers the hand-off, so opening another
  // editor commits the rename rather than discarding it (task 7b60c7c5).
  useEffect(() => {
    renameRef.current = { id: editingPasskeyId, name: editingPasskeyName }
  })
  useEffect(() => {
    if (!editingPasskeyId) return
    session.registerCommit(`passkey:${editingPasskeyId}`, () => {
      const { id, name } = renameRef.current
      if (id && name.trim()) void handleRenamePasskey(id)
    })
  }, [session, editingPasskeyId])

  const handleDeletePasskey = async (id: string) => {
    setDeletingPasskeyId(id)
    try {
      const response = await fetch(`/api/auth/webauthn/passkeys?id=${id}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: t("settingsPages.passkeys.toasts.deletedTitle"),
          description: t("settingsPages.passkeys.toasts.deletedDesc"),
          duration: 3000,
        })
        loadPasskeys()
      } else {
        const error = await response.json()
        toast({
          title: t("messages.error"),
          description: error.error || t("settingsPages.passkeys.toasts.deleteFailed"),
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error deleting passkey:", error)
      toast({
        title: t("messages.error"),
        description: t("settingsPages.passkeys.toasts.deleteFailed"),
        duration: 5000,
      })
    } finally {
      setDeletingPasskeyId(null)
    }
  }

  if (!isPasskeySupported) return null

  return (
    <Card className="theme-bg-secondary theme-border">
      <CardHeader>
        <CardTitle className="theme-text-primary flex items-center space-x-2">
          <KeyRound className="w-5 h-5" />
          <span>{t("settingsPages.passkeys.title")}</span>
        </CardTitle>
        <CardDescription className="theme-text-muted">
          {t("settingsPages.passkeys.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing Passkeys */}
        {loadingPasskeys ? (
          <div className="text-center py-4 theme-text-muted">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
            {t("settingsPages.passkeys.loading")}
          </div>
        ) : passkeys.length > 0 ? (
          <div className="space-y-3">
            {passkeys.map((passkey) => (
              <div
                key={passkey.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 theme-bg-tertiary rounded-lg"
              >
                <div className="flex flex-wrap items-center gap-3 min-w-0">
                  <Smartphone className="w-5 h-5 theme-text-muted shrink-0" />
                  <div className="min-w-0">
                    {editingPasskeyId === passkey.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={editingPasskeyName}
                          onChange={(e) => setEditingPasskeyName(e.target.value)}
                          className="h-7 text-sm theme-input theme-text-primary w-full sm:w-40"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleRenamePasskey(passkey.id)
                            } else if (e.key === "Escape") {
                              session.cancelEditing(`passkey:${passkey.id}`)
                              setEditingPasskeyId(null)
                              setEditingPasskeyName("")
                            }
                          }}
                          autoFocus
                        />
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRenamePasskey(passkey.id)}
                            className="h-7 px-2"
                          >
                            <CheckCircle className="w-4 h-4 text-success" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              session.cancelEditing(`passkey:${passkey.id}`)
                              setEditingPasskeyId(null)
                              setEditingPasskeyName("")
                            }}
                            className="h-7 px-2"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="theme-text-primary text-sm font-medium truncate">
                          {passkey.name || t("settingsPages.passkeys.fallbackName")}
                        </div>
                        <div className="theme-text-muted text-xs">
                          {t("settingsPages.passkeys.added", { date: new Date(passkey.createdAt).toLocaleDateString() })}
                          {passkey.credentialBackedUp && ` • ${t("settingsPages.passkeys.synced")}`}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {editingPasskeyId !== passkey.id && (
                  <div className="flex items-center gap-1 ml-auto">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        session.beginEditing(`passkey:${passkey.id}`)
                        setEditingPasskeyId(passkey.id)
                        setEditingPasskeyName(passkey.name || t("settingsPages.passkeys.fallbackName"))
                      }}
                      className="h-8 px-2 theme-text-muted hover:theme-text-primary"
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeletePasskey(passkey.id)}
                      disabled={deletingPasskeyId === passkey.id}
                      className="h-8 px-2 text-danger hover:text-danger"
                    >
                      {deletingPasskeyId === passkey.id ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 theme-text-muted">
            <KeyRound className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>{t("settingsPages.passkeys.noPasskeys")}</p>
            <p className="text-sm mt-1">{t("settingsPages.passkeys.addPasskeyHint")}</p>
          </div>
        )}

        {/* Add Passkey Button */}
        <Button
          onClick={handleAddPasskey}
          disabled={isPasskeyLoading}
          className="w-full bg-brand hover:bg-brand-hover text-brand-foreground"
        >
          {isPasskeyLoading ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 mr-2" />
          )}
          {isPasskeyLoading ? t("settingsPages.passkeys.addingPasskey") : t("settingsPages.passkeys.addPasskey")}
        </Button>

        {passkeyError && (
          <Alert className="border-danger bg-danger-subtle">
            <AlertCircle className="w-4 h-4 text-danger" />
            <AlertDescription className="text-theme-primary text-sm">
              {passkeyError}
            </AlertDescription>
          </Alert>
        )}

        {/* Info */}
        <div className="text-sm theme-text-muted space-y-1">
          <p>• {t("settingsPages.passkeys.tipBiometrics")}</p>
          <p>• {t("settingsPages.passkeys.tipSynced")}</p>
          <p>• {t("settingsPages.passkeys.tipSecure")}</p>
        </div>
      </CardContent>
    </Card>
  )
}
