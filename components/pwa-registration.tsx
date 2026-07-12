'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { shouldReloadForControllerChange } from '@/lib/pwa-update-policy'

export function PWARegistration() {
  const router = useRouter()
  
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Register service worker
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          if (process.env.NODE_ENV === 'development') {
            console.log('✅ Service Worker registered:', registration.scope)
          }
          
        })
        .catch((error) => {
          // Only log in development - in production, SW failures are expected on some browsers
          if (process.env.NODE_ENV === 'development') {
            console.error('❌ Service Worker registration failed:', error)
          }
        })

      // Handle service worker updates
      let reloadingForUpdate = false
      const handleControllerChange = () => {
        if (!shouldReloadForControllerChange(reloadingForUpdate)) return
        reloadingForUpdate = true
        window.location.reload()
      }
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)

      // Handle messages from service worker for navigation
      const handleMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'NAVIGATE') {
          try {
            // Use Next.js router to navigate
            router.push(event.data.url)
            
            // Send confirmation back to service worker
            if (event.ports[0]) {
              event.ports[0].postMessage({ success: true })
            }
          } catch (error) {
            if (process.env.NODE_ENV === 'development') {
              console.error('PWA: Navigation failed:', error)
            }
            
            if (event.ports[0]) {
              event.ports[0].postMessage({ 
                success: false, 
                error: error instanceof Error ? error.message : 'Navigation failed' 
              })
            }
          }
        }
      }
      navigator.serviceWorker.addEventListener('message', handleMessage)

      // Handle beforeinstallprompt for custom install button
      let deferredPrompt: any = null

      const handleBeforeInstallPrompt = (e: Event) => {
        // Prevent the mini-infobar from appearing on mobile
        e.preventDefault()
        // Stash the event so it can be triggered later
        deferredPrompt = e
      }
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

      // Handle app installed
      const handleAppInstalled = () => {
        deferredPrompt = null
      }
      window.addEventListener('appinstalled', handleAppInstalled)

      return () => {
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
        navigator.serviceWorker.removeEventListener('message', handleMessage)
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
        window.removeEventListener('appinstalled', handleAppInstalled)
      }
    }
  }, [router])

  return null
}
