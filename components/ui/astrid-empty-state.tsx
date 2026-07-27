"use client"

import { BRAND } from '@/lib/brand/config'
import { memo } from 'react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/i18n/client'

interface AstridEmptyStateProps {
  listType: 'personal' | 'shared' | 'today' | 'my-tasks' | 'public' | 'assigned' | 'not-in-list' | 'default'
  listName?: string
  isViewingFromFeatured?: boolean
  className?: string
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
  className = ''
}) => {
  const { t } = useTranslations()

  // Get contextual message based on list type
  const getMessage = (): string => {
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
    <div className={cn(
      'flex flex-col items-center justify-center py-12 px-4',
      className
    )}>
      {/* Astrid with Speech Bubble - matching push notification style */}
      <div className="flex items-start space-x-4 max-w-lg w-full animate-in fade-in slide-in-from-bottom-2 duration-500">
        {/* Astrid Icon - 1/3 of width, matching popover */}
        <div className="flex-shrink-0" style={{ width: '33%' }}>
          <img
            src="/icons/icon-512x512.png"
            alt={BRAND.appName}
            className="w-full h-auto"
          />
        </div>

        {/* Speech Bubble - matching popover style exactly */}
        <div className="flex-1">
          <div className="relative theme-bg-secondary rounded-2xl p-4 border-2 theme-border shadow-lg z-0">
            {/* Comic-style speech bubble pointer - outer border (points left toward Astrid) */}
            <div className="absolute -left-[16px] top-6 w-0 h-0 border-t-[12px] border-t-transparent border-r-[16px] border-r-gray-300 dark:border-r-gray-600 border-b-[12px] border-b-transparent border-l-0 z-10"></div>
            {/* Inner pointer fill (covers outer to create border effect) */}
            <div className="absolute -left-[12px] top-[27px] w-0 h-0 border-t-[9px] border-t-transparent border-r-[13px] border-b-[10px] border-b-transparent border-l-0 z-10 speech-bubble-arrow-fill"></div>
            <p className="text-base font-semibold theme-text-primary leading-relaxed">
              {message}
            </p>
          </div>
        </div>
      </div>

      {/* Subtle hint arrow pointing down to input (mobile only) */}
      <div className="mt-8 animate-in fade-in duration-500 delay-300 md:hidden">
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
