"use client"

import { BRAND } from '@/lib/brand/config'
import { SpeechBubbleTail } from '@/components/ui/speech-bubble-tail'
import { memo, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/i18n/client'

interface AstridEmptyStateProps {
  listType: 'personal' | 'shared' | 'today' | 'my-tasks' | 'public' | 'assigned' | 'not-in-list' | 'default'
  listName?: string
  isViewingFromFeatured?: boolean
  className?: string
  /** Overrides the list-type message, e.g. a board column's own (ADEV-85). */
  message?: string
  /**
   * A richer picture of the character to show instead, once it has loaded: a board column's
   * empathy frame (ADEV-144). Until then, and if it fails, the brand icon stays.
   */
  characterSrc?: string | null
  /** The art's width. A board column passes its token size (register DS36); elsewhere a third. */
  artClassName?: string
  /** The bubble's padding, 16 unless a board column passes its density's. */
  bubblePaddingClassName?: string
}

/**
 * AstridEmptyState - Reminders-style empty state with speech bubble
 *
 * Displays Astrid character (favicon-512x512) with contextual encouragement based on list type.
 * Matches the push notification popover style from astrid-reminder-popover.tsx.
 */
export const AstridEmptyState = memo<AstridEmptyStateProps>(({
  listType,
  listName,
  isViewingFromFeatured = false,
  className = '',
  message: messageOverride,
  characterSrc,
  artClassName = 'w-1/3',
  bubblePaddingClassName = 'p-4',
}) => {
  const { t } = useTranslations()
  const [loadedCharacterSrc, setLoadedCharacterSrc] = useState<string | null>(null)

  // Preload off-screen and swap only once the bytes are here, so the column never flashes an
  // empty box or a broken image while the frame downloads.
  useEffect(() => {
    if (!characterSrc) return
    let cancelled = false
    const image = new Image()
    image.onload = () => { if (!cancelled) setLoadedCharacterSrc(characterSrc) }
    image.src = characterSrc
    return () => { cancelled = true }
  }, [characterSrc])

  const shownCharacterSrc = characterSrc && loadedCharacterSrc === characterSrc ? characterSrc : BRAND.icon

  // Get contextual message based on list type
  const getMessage = (): string => {
    if (messageOverride) return messageOverride
    if (isViewingFromFeatured) {
      return t("emptyState.featured")
    }

    switch (listType) {
      case 'today':
        return t("emptyState.today")

      case 'my-tasks':
        return t("emptyState.myTasks")

      case 'assigned':
        return t("emptyState.assigned")

      case 'not-in-list':
        return t("emptyState.notInList")

      case 'shared':
        return t("emptyState.shared")

      case 'public':
        return t("emptyState.public")

      case 'personal':
        return t("emptyState.personal")

      default:
        return listName
          ? t("emptyState.default", { listName })
          : t("emptyState.defaultNoName")
    }
  }

  const message = getMessage()

  return (
    <div data-testid="empty-state" className={cn(
      'flex flex-col items-center justify-center py-12 px-4',
      className
    )}>
      {/* Astrid with Speech Bubble - matching push notification style */}
      <div className="flex items-start space-x-4 max-w-lg w-full animate-in fade-in slide-in-from-bottom-2 duration-panel">
        {/* Astrid Icon - 1/3 of width, matching popover */}
        <div className={cn('flex-shrink-0', artClassName)}>
          <img
            src={shownCharacterSrc}
            alt={BRAND.appName}
            className="w-full h-auto"
            data-testid="empty-state-character"
          />
        </div>

        {/* Speech Bubble - matching popover style exactly */}
        <div className="flex-1">
          <div className={cn('relative theme-bg-secondary rounded-2xl border-2 theme-border shadow-lg z-0', bubblePaddingClassName)}>
            <SpeechBubbleTail />
            <p className="text-base font-semibold theme-text-primary leading-relaxed">
              {message}
            </p>
          </div>
        </div>
      </div>

      {/* Subtle hint arrow pointing down to input (mobile only) */}
      <div className="mt-8 animate-in fade-in duration-panel delay-300 md:hidden">
        <div className="flex flex-col items-center gap-1 theme-text-muted opacity-40">
          <div className="text-xs font-medium">{t("emptyState.addTaskHint")}</div>
          <svg width="16" height="20" viewBox="0 0 16 20" fill="none" className="animate-bounce">
            <path d="M8 0L8 18M8 18L1 11M8 18L15 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
    </div>
  )
})

AstridEmptyState.displayName = 'AstridEmptyState'
