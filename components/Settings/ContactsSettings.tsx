"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslations } from "@/lib/i18n/client"
import {
  Users,
  Trash2,
  CloudDownload,
  CheckCircle,
  AlertCircle,
  Loader2
} from "lucide-react"

interface ContactsSettingsProps {
  onNavigate: (page: string) => void
}

interface ContactStats {
  total: number
  lastSync: string | null
}

export default function ContactsSettings({ onNavigate }: ContactsSettingsProps) {
  const { t } = useTranslations()
  const [stats, setStats] = useState<ContactStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Check for OAuth callback result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const googleResult = params.get('google')
    const importedCount = params.get('imported')

    if (googleResult === 'success' && importedCount) {
      setMessage({ type: 'success', text: t('settingsPages.contacts.importSuccess', { count: importedCount }) })
      // Clean up URL
      window.history.replaceState({}, '', '/settings/contacts')
      // Refresh stats
      fetchStats()
    } else if (googleResult === 'error') {
      setMessage({ type: 'error', text: t('settingsPages.contacts.importError') })
      window.history.replaceState({}, '', '/settings/contacts')
    }
  }, [t])

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/v1/contacts?limit=1')
      if (response.ok) {
        const data = await response.json()
        setStats({
          total: data.pagination.total,
          lastSync: data.contacts[0]?.uploadedAt || null
        })
      }
    } catch (error) {
      console.error('Failed to fetch contact stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleImport = () => {
    // Redirect to Google OAuth for contacts
    setImporting(true)
    window.location.href = '/api/contacts/google/authorize'
  }

  const handleClearContacts = async () => {
    if (!confirm(t('settingsPages.contacts.clearConfirmation'))) {
      return
    }

    try {
      setClearing(true)
      const response = await fetch('/api/v1/contacts', { method: 'DELETE' })
      if (response.ok) {
        const data = await response.json()
        setMessage({ type: 'success', text: t('settingsPages.contacts.clearSuccess', { count: data.deleted }) })
        setStats({ total: 0, lastSync: null })
      } else {
        throw new Error('Failed to clear contacts')
      }
    } catch (error) {
      setMessage({ type: 'error', text: t('settingsPages.contacts.clearError') })
    } finally {
      setClearing(false)
    }
  }

  if (loading) {
    return (
      <div className="p-2 sm:p-4">
        <div className="max-w-sm sm:max-w-2xl mx-auto flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin theme-text-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-2 sm:p-4">
      <div className="max-w-sm sm:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        {/* Page Header */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-lg flex items-center justify-center">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold theme-text-primary">{t('settingsPages.contacts.title')}</h1>
            <p className="theme-text-muted">{t('settingsPages.contacts.description')}</p>
          </div>
        </div>

        {/* Status Message */}
        {message && (
          <div className={`p-4 rounded-lg flex items-center space-x-2 ${
            message.type === 'success'
              ? 'bg-green-500/10 text-green-500'
              : 'bg-red-500/10 text-red-500'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            <span>{message.text}</span>
            <button
              className="ml-auto hover:opacity-70"
              onClick={() => setMessage(null)}
            >
              ×
            </button>
          </div>
        )}

        {/* Current Stats */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary">{t('settingsPages.contacts.syncedTitle')}</CardTitle>
            <CardDescription className="theme-text-muted">
              {t('settingsPages.contacts.syncedDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-3xl font-bold theme-text-primary">{stats?.total || 0}</p>
                <p className="text-sm theme-text-muted">{t('settingsPages.contacts.contactsSynced')}</p>
              </div>
              {stats?.lastSync && (
                <div className="text-right">
                  <p className="text-sm theme-text-muted">{t('settingsPages.contacts.lastUpdated')}</p>
                  <p className="text-sm theme-text-secondary">
                    {new Date(stats.lastSync).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Import Options */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader>
            <CardTitle className="theme-text-primary">{t('settingsPages.contacts.importTitle')}</CardTitle>
            <CardDescription className="theme-text-muted">
              {t('settingsPages.contacts.importDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Google Contacts */}
            <div className="flex items-center justify-between p-4 rounded-lg theme-bg-tertiary">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-medium theme-text-primary">{t('settingsPages.contacts.googleContacts')}</p>
                  <p className="text-sm theme-text-muted">{t('settingsPages.contacts.googleDescription')}</p>
                </div>
              </div>
              <Button
                onClick={handleGoogleImport}
                disabled={importing}
                className="bg-blue-500 hover:bg-blue-600"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('settingsPages.contacts.connecting')}
                  </>
                ) : (
                  <>
                    <CloudDownload className="w-4 h-4 mr-2" />
                    {t('settingsPages.contacts.import')}
                  </>
                )}
              </Button>
            </div>

            <p className="text-xs theme-text-muted">
              {t('settingsPages.contacts.privacyNotice')}
            </p>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        {stats && stats.total > 0 && (
          <Card className="theme-bg-secondary border-red-500/20">
            <CardHeader>
              <CardTitle className="text-red-500">{t('settingsPages.contacts.dangerZone')}</CardTitle>
              <CardDescription className="theme-text-muted">
                {t('settingsPages.contacts.irreversibleActions')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium theme-text-primary">{t('settingsPages.contacts.clearAll')}</p>
                  <p className="text-sm theme-text-muted">
                    {t('settingsPages.contacts.clearAllDescription')}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={handleClearContacts}
                  disabled={clearing}
                >
                  {clearing ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-2" />
                  )}
                  {t('settingsPages.contacts.clearContacts')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
