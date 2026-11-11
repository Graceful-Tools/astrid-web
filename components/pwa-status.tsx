'use client'

import { useState, useEffect } from 'react'
import { Wifi, WifiOff, X } from 'lucide-react'
import { OfflineSyncManager } from '@/lib/offline-sync'
import { Button } from '@/components/ui/button'

export function PWAStatus() {
  const [isOnline, setIsOnline] = useState(true)
  const [showStatus, setShowStatus] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)

  // Update pending mutations count
  const updatePendingCount = async () => {
    try {
      const stats = await OfflineSyncManager.getMutationStats()
      setPendingCount(stats.pending)
    } catch (error) {
      console.error('Failed to get pending mutations:', error)
    }
  }

  useEffect(() => {
    // Set initial online status
    setIsOnline(navigator.onLine)

    const handleOnline = async () => {
      setIsOnline(true)
      setShowStatus(true)

      // Try to sync pending mutations
      if (pendingCount > 0) {
        setIsSyncing(true)
        try {
          await OfflineSyncManager.syncPendingMutations()
          await updatePendingCount()
        } catch (error) {
          console.error('Auto-sync failed:', error)
        } finally {
          setIsSyncing(false)
        }
      }

      // Hide status after 5 seconds (or after sync completes)
      setTimeout(() => setShowStatus(false), 5000)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setShowStatus(true)
      // Keep showing offline status until back online
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [pendingCount])

  // Update pending count periodically when offline
  useEffect(() => {
    if (!isOnline) {
      updatePendingCount()
      const interval = setInterval(updatePendingCount, 5000)
      return () => clearInterval(interval)
    }
  }, [isOnline])

  if (!showStatus) return null

  return (
    <div className="fixed top-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm z-50 transition-all duration-300">
      <div className={`flex items-center justify-between space-x-2 px-3 py-2 rounded-lg shadow-lg ${
        isOnline
          ? 'bg-theme-surface text-theme-primary border border-success'
          : 'bg-theme-surface text-theme-primary border border-warning'
      }`}>
        <div className="flex items-center space-x-2 flex-1">
          {isOnline ? (
            <Wifi className="w-4 h-4 flex-shrink-0 text-success" />
          ) : (
            <WifiOff className="w-4 h-4 flex-shrink-0 text-warning" />
          )}
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {isOnline ? 'Back online' : 'You are offline'}
            </span>
            {!isOnline && pendingCount > 0 && (
              <span className="text-xs opacity-90">
                {pendingCount} change{pendingCount !== 1 ? 's' : ''} pending
              </span>
            )}
            {isOnline && isSyncing && (
              <span className="text-xs opacity-90">
                Syncing changes...
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowStatus(false)}
          className="h-6 w-6 p-0 hover:bg-transparent"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
