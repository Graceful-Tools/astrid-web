"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useToast } from "@/hooks/use-toast"
import {
  User,
  Mail,
  Shield,
  CheckCircle,
  AlertCircle,
  Clock,
  X,
  RefreshCw,
  Heart,
  ArrowLeft,
  Download,
  Trash2,
  FileJson,
  FileText,
  ExternalLink,
  KeyRound,
  Plus,
  Pencil,
  Smartphone
} from "lucide-react"
import { useWebAuthn } from "@/hooks/use-webauthn"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { signOut } from "next-auth/react"
import { useTranslations } from "@/lib/i18n/client"
import { EmailVerificationSection } from "./EmailVerificationSection"
import { AccountInfoSection } from "./AccountInfoSection"
import { DataExportSection } from "./DataExportSection"
import { AccountDeletionSection } from "./AccountDeletionSection"

export interface AccountData {
  id: string
  name: string | null
  email: string
  emailVerified: Date | null
  image: string | null
  pendingEmail: string | null
  verified: boolean
  hasPendingChange: boolean
  hasPendingVerification: boolean
  verifiedViaOAuth?: boolean
  createdAt: string
  updatedAt: string
}

interface Passkey {
  id: string
  name: string | null
  credentialDeviceType: string
  credentialBackedUp: boolean
  createdAt: string
}

interface AccountSettingsProps {
  onNavigate: (page: string) => void
}

export default function AccountSettings({ onNavigate }: AccountSettingsProps) {
  const { t } = useTranslations()
  const { data: session, status, update } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()

  const [accountData, setAccountData] = useState<AccountData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resendingVerification, setResendingVerification] = useState(false)

  // Form state
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [hasChanges, setHasChanges] = useState(false)

  // Profile photo upload state
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null)

  // Export state
  const [exporting, setExporting] = useState(false)

  // Delete account state — modal open/text moved into AccountDeletionSection.
  const [deleting, setDeleting] = useState(false)

  // Passkey state
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loadingPasskeys, setLoadingPasskeys] = useState(true)
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null)
  const [editingPasskeyName, setEditingPasskeyName] = useState("")
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null)

  const {
    isSupported: isPasskeySupported,
    isLoading: isPasskeyLoading,
    error: passkeyError,
    registerPasskey,
    clearError: clearPasskeyError,
  } = useWebAuthn()

  useEffect(() => {
    if (session?.user) {
      loadAccountData()
    }

    // Check for verification success
    if (searchParams?.get('verified') === 'true') {
      toast({
        title: "Email Verified!",
        description: "Your email address has been successfully verified.",
        duration: 5000,
      })
    }
  }, [session, status, searchParams, toast])

  useEffect(() => {
    if (accountData) {
      setName(accountData.name || "")
      setEmail(accountData.email)
      setCustomImageUrl(accountData.image || null)
    }
  }, [accountData])

  // Separate effect for change detection
  useEffect(() => {
    if (accountData) {
      const nameChanged = (accountData.name || "") !== name
      const emailChanged = accountData.email !== email
      const imageChanged = (accountData.image || null) !== customImageUrl
      setHasChanges(nameChanged || emailChanged || imageChanged)
    }
  }, [name, email, customImageUrl, accountData])

  const loadAccountData = async () => {
    try {
      const response = await fetch("/api/account")
      if (response.ok) {
        const data = await response.json()
        setAccountData(data.user)
      } else {
        console.error("Failed to load account data:", response.status)
      }
    } catch (error) {
      console.error("Error loading account data:", error)
    } finally {
      setLoading(false)
    }
  }

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
    if (session?.user) {
      loadPasskeys()
    }
  }, [session])

  const handleSave = async () => {
    if (!accountData) return

    setSaving(true)
    try {
      // Only include image in update if it has actually changed
      const updateData: any = { name, email }
      if (customImageUrl !== accountData.image) {
        updateData.image = customImageUrl
      }

      const response = await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      })

      if (response.ok) {
        await loadAccountData()

        toast({
          title: "Success!",
          description: "Your account information has been updated.",
          duration: 3000,
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to update account information.",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error updating account:", error)
      toast({
        title: "Error",
        description: "Failed to update account information.",
        duration: 5000,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleResendVerification = async () => {
    if (!accountData) return

    setResendingVerification(true)
    try {
      const response = await fetch("/api/account/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend" }),
      })

      if (response.ok) {
        toast({
          title: "Verification Email Sent!",
          description: "Please check your email and click the verification link.",
          duration: 5000,
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to send verification email.",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error sending verification email:", error)
      toast({
        title: "Error",
        description: "Failed to send verification email.",
        duration: 5000,
      })
    } finally {
      setResendingVerification(false)
    }
  }

  const handleCancelEmailChange = async () => {
    if (!accountData) return

    try {
      const response = await fetch("/api/account/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      })

      if (response.ok) {
        await loadAccountData()
        toast({
          title: "Email Change Cancelled",
          description: "Your email change request has been cancelled.",
          duration: 3000,
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to cancel email change.",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error cancelling email change:", error)
      toast({
        title: "Error",
        description: "Failed to cancel email change.",
        duration: 5000,
      })
    }
  }

  const handleExport = async (format: "json" | "csv") => {
    setExporting(true)
    try {
      const response = await fetch(`/api/account/export?format=${format}`)

      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `astrid-export-${new Date().toISOString().split('T')[0]}.${format}`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)

        toast({
          title: "Export Complete!",
          description: `Your data has been exported as ${format.toUpperCase()}.`,
          duration: 3000,
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to export data.",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error exporting data:", error)
      toast({
        title: "Error",
        description: "Failed to export data.",
        duration: 5000,
      })
    } finally {
      setExporting(false)
    }
  }

  const handleAddPasskey = async () => {
    clearPasskeyError()
    const result = await registerPasskey(undefined, "My Passkey")
    if (result.success) {
      toast({
        title: "Passkey Added!",
        description: "Your new passkey has been registered.",
        duration: 3000,
      })
      loadPasskeys()
    } else if (passkeyError) {
      toast({
        title: "Error",
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
          title: "Passkey Renamed",
          description: "Your passkey has been renamed.",
          duration: 3000,
        })
        setEditingPasskeyId(null)
        setEditingPasskeyName("")
        loadPasskeys()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to rename passkey.",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error renaming passkey:", error)
      toast({
        title: "Error",
        description: "Failed to rename passkey.",
        duration: 5000,
      })
    }
  }

  const handleDeletePasskey = async (id: string) => {
    setDeletingPasskeyId(id)
    try {
      const response = await fetch(`/api/auth/webauthn/passkeys?id=${id}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Passkey Deleted",
          description: "Your passkey has been removed.",
          duration: 3000,
        })
        loadPasskeys()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to delete passkey.",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error deleting passkey:", error)
      toast({
        title: "Error",
        description: "Failed to delete passkey.",
        duration: 5000,
      })
    } finally {
      setDeletingPasskeyId(null)
    }
  }

  const handleDeleteAccount = async (confirmationText: string) => {
    if (confirmationText !== "DELETE MY ACCOUNT") {
      toast({
        title: "Error",
        description: "Please type 'DELETE MY ACCOUNT' to confirm.",
        duration: 5000,
      })
      return
    }

    setDeleting(true)
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmationText,
        }),
      })

      if (response.ok) {
        toast({
          title: "Account Deleted",
          description: "Your account has been permanently deleted. Redirecting...",
          duration: 3000,
        })

        // Sign out and redirect to home
        setTimeout(() => {
          signOut({ callbackUrl: "/" })
        }, 2000)
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to delete account.",
          duration: 5000,
        })
        setDeleting(false)
      }
    } catch (error) {
      console.error("Error deleting account:", error)
      toast({
        title: "Error",
        description: "Failed to delete account.",
        duration: 5000,
      })
      setDeleting(false)
    }
  }

  if (loading) {
    return null
  }

  if (!session?.user || !accountData || !accountData.email) {
    return null
  }

  return (
    <>
      {/* Settings Content */}
      <div className="p-2 sm:p-4">
        <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
          {/* Settings Page Header */}
          <div className="flex flex-wrap items-center gap-3">
            <Shield className="w-8 h-8 text-blue-500" />
            <div>
              <h1 className="text-2xl font-bold theme-text-primary">{t("settingsPages.accountAccess.title")}</h1>
              <p className="theme-text-muted">{t("settingsPages.accountAccess.description")}</p>
            </div>
          </div>

          {/* Profile Section */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex flex-wrap items-center gap-2">
                <User className="w-5 h-5" />
                <span>{t("settingsPages.profileInfo.title")}</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                {t("settingsPages.profileInfo.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-4">
                  <Avatar className="w-16 h-16 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => document.getElementById('profile-photo-upload')?.click()}>
                    <AvatarImage src={customImageUrl || accountData.image || "/placeholder.svg"} />
                    <AvatarFallback>
                      {accountData.name?.charAt(0) || accountData.email?.charAt(0) || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-sm theme-text-muted space-y-1">
                    <p>{t("settingsPages.profileInfo.clickToChangePhoto")}</p>
                    {accountData.verifiedViaOAuth && (
                      <p className="text-xs">Currently synced with your OAuth provider</p>
                    )}
                    {uploadingPhoto && (
                      <p className="text-xs text-blue-400">Uploading...</p>
                    )}
                  </div>
                  <input
                    id="profile-photo-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return

                      setUploadingPhoto(true)
                      try {
                        const formData = new FormData()
                        formData.append("file", file)

                        const response = await fetch("/api/upload", {
                          method: "POST",
                          body: formData,
                        })

                        if (response.ok) {
                          const data = await response.json()
                          setCustomImageUrl(data.url)
                          toast({
                            title: "Photo uploaded!",
                            description: "Click 'Save Changes' to update your profile.",
                            duration: 3000,
                          })
                        } else {
                          toast({
                            title: "Upload failed",
                            description: "Failed to upload photo. Please try again.",
                            duration: 5000,
                          })
                        }
                      } catch (error) {
                        console.error("Upload error:", error)
                        toast({
                          title: "Upload failed",
                          description: "Failed to upload photo. Please try again.",
                          duration: 5000,
                        })
                      } finally {
                        setUploadingPhoto(false)
                      }
                    }}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/u/${accountData.id}`)}
                  className="border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {t("settingsPages.profileInfo.viewPublicProfile")}
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="name" className="theme-text-secondary">{t("settingsPages.profileInfo.displayName")}</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your display name"
                    className="theme-input theme-text-primary focus:border-blue-500 focus:ring-blue-500 cursor-text"
                    disabled={false}
                    readOnly={false}
                    autoComplete="name"
                  />
                </div>

                <div>
                  <Label htmlFor="email" className="theme-text-secondary">{t("settingsPages.profileInfo.emailAddress")}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="theme-input theme-text-primary"
                  />
                </div>

                {hasChanges && (
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {saving ? t("settingsPages.profileInfo.saving") : t("settingsPages.profileInfo.saveChanges")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <EmailVerificationSection
            accountData={accountData}
            resendingVerification={resendingVerification}
            onResendVerification={handleResendVerification}
            onCancelEmailChange={handleCancelEmailChange}
          />

          {/* Passkeys Section */}
          {isPasskeySupported && (
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
                    Loading passkeys...
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
                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
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
                                  {passkey.name || "Passkey"}
                                </div>
                                <div className="theme-text-muted text-xs">
                                  Added {new Date(passkey.createdAt).toLocaleDateString()}
                                  {passkey.credentialBackedUp && " • Synced"}
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
                                setEditingPasskeyId(passkey.id)
                                setEditingPasskeyName(passkey.name || "Passkey")
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
                              className="h-8 px-2 text-red-400 hover:text-red-300"
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
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {isPasskeyLoading ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4 mr-2" />
                  )}
                  {isPasskeyLoading ? t("settingsPages.passkeys.addingPasskey") : t("settingsPages.passkeys.addPasskey")}
                </Button>

                {passkeyError && (
                  <Alert className="border-red-600 bg-red-900/20">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <AlertDescription className="text-red-300 text-sm">
                      {passkeyError}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Info */}
                <div className="text-sm theme-text-muted space-y-1">
                  <p>• Passkeys use biometrics or device PIN for authentication</p>
                  <p>• Synced passkeys work across your devices automatically</p>
                  <p>• More secure than passwords - resistant to phishing</p>
                </div>

              </CardContent>
            </Card>
          )}

          <AccountInfoSection accountData={accountData} />

          <DataExportSection exporting={exporting} onExport={handleExport} />

          <AccountDeletionSection deleting={deleting} onConfirmDelete={handleDeleteAccount} />
        </div>
      </div>
    </>
  )
}
