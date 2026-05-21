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
import { PasskeyManagementSection } from "./PasskeyManagementSection"
import { ProfileSection } from "./ProfileSection"

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
  const [resendingVerification, setResendingVerification] = useState(false)

  // Export state
  const [exporting, setExporting] = useState(false)

  // Delete account state — modal open/text moved into AccountDeletionSection.
  const [deleting, setDeleting] = useState(false)

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
          <ProfileSection accountData={accountData} onSaved={loadAccountData} />

          <EmailVerificationSection
            accountData={accountData}
            resendingVerification={resendingVerification}
            onResendVerification={handleResendVerification}
            onCancelEmailChange={handleCancelEmailChange}
          />

          {/* Passkeys */}
          <PasskeyManagementSection />

          <AccountInfoSection accountData={accountData} />

          <DataExportSection exporting={exporting} onExport={handleExport} />

          <AccountDeletionSection deleting={deleting} onConfirmDelete={handleDeleteAccount} />
        </div>
      </div>
    </>
  )
}
