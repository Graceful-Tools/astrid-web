/**
 * The share-a-task-by-link flow: open the modal, mint a shortcode, copy it.
 *
 * Extracted from `components/task-detail.tsx` and
 * `components/task-detail-viewonly.tsx`, which each carried their own copy of
 * the same four state variables and the same three handlers (task 72cb4a13).
 * The two copies had already begun to drift: the editable one logged the
 * non-ok response body and the missing-`url` case, the view-only one silently
 * set `shareUrl` to null. The richer diagnostics are kept here, so both
 * surfaces now report a failed share the same way.
 *
 * This is a pure move — no behaviour changes with it. In particular the
 * "Copied!" flag still resets on a 2s `setTimeout` that is not cancelled on
 * unmount; that was true of both originals and is left alone deliberately, so
 * the extraction stays reviewable as a move rather than a move-plus-fix.
 *
 * Owning the state here rather than threading it through `useTaskDetailState`
 * is the point: nothing outside this flow ever read those four fields, so the
 * modal state was public for no reason.
 */

'use client'

import { useState } from 'react'

export interface TaskShareLink {
  showShareModal: boolean
  shareUrl: string | null
  loadingShareUrl: boolean
  shareUrlCopied: boolean
  openShareModal: () => Promise<void>
  copyShareUrl: () => Promise<void>
  closeShareModal: () => void
}

export function useTaskShareLink(taskId: string): TaskShareLink {
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [loadingShareUrl, setLoadingShareUrl] = useState(false)
  const [shareUrlCopied, setShareUrlCopied] = useState(false)

  // Opening the modal is what mints the shortcode — there is no separate
  // "generate" step, so the modal always opens before the request resolves and
  // shows the loading state in the meantime.
  const openShareModal = async () => {
    setShowShareModal(true)
    setShareUrlCopied(false)
    setShareUrl(null)
    setLoadingShareUrl(true)

    try {
      const response = await fetch('/api/v1/shortcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'task',
          targetId: taskId,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.url) {
          setShareUrl(data.url)
        } else {
          console.error('No URL in response:', data)
          setShareUrl(null)
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        console.error('Failed to generate share URL:', response.status, errorData)
        setShareUrl(null)
      }
    } catch (error) {
      console.error('Error generating share URL:', error)
      setShareUrl(null)
    } finally {
      setLoadingShareUrl(false)
    }
  }

  const copyShareUrl = async () => {
    if (shareUrl) {
      try {
        await navigator.clipboard.writeText(shareUrl)
        setShareUrlCopied(true)
        setTimeout(() => setShareUrlCopied(false), 2000)
      } catch (error) {
        console.error('Failed to copy URL:', error)
      }
    }
  }

  const closeShareModal = () => {
    setShowShareModal(false)
    setShareUrl(null)
    setShareUrlCopied(false)
  }

  return {
    showShareModal,
    shareUrl,
    loadingShareUrl,
    shareUrlCopied,
    openShareModal,
    copyShareUrl,
    closeShareModal,
  }
}
