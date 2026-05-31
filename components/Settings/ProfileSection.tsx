"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { User, ExternalLink } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useTranslations } from "@/lib/i18n/client"
import type { AccountData } from "./AccountSettings"

interface ProfileSectionProps {
  accountData: AccountData
  /** Called after a successful PUT /api/account so the parent can
   *  refresh its accountData (which downstream sections also consume). */
  onSaved: () => Promise<void> | void
}

/**
 * Profile card for the account settings page: avatar + display name +
 * email, with click-to-upload photo and a Save Changes button. Extracted
 * from AccountSettings.tsx (Stage 14d). Owns the draft/upload/save state
 * — the parent only loads accountData and is notified after save.
 */
export function ProfileSection({ accountData, onSaved }: ProfileSectionProps) {
  const { t } = useTranslations()
  const { toast } = useToast()
  const router = useRouter()

  const [name, setName] = useState(accountData.name || "")
  const [email, setEmail] = useState(accountData.email)
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(accountData.image || null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [saving, setSaving] = useState(false)

  // Re-sync the draft when accountData changes (e.g. after a save refresh).
  useEffect(() => {
    setName(accountData.name || "")
    setEmail(accountData.email)
    setCustomImageUrl(accountData.image || null)
  }, [accountData.name, accountData.email, accountData.image])

  const hasChanges =
    (accountData.name || "") !== name ||
    accountData.email !== email ||
    (accountData.image || null) !== customImageUrl

  const handleSave = async () => {
    setSaving(true)
    try {
      const updateData: Record<string, unknown> = { name, email }
      if (customImageUrl !== accountData.image) {
        updateData.image = customImageUrl
      }

      const response = await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      })

      if (response.ok) {
        await onSaved()
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

  return (
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
            <Avatar
              className="w-16 h-16 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => document.getElementById('profile-photo-upload')?.click()}
            >
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
  )
}
