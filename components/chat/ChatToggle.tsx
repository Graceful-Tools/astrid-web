"use client"

import React from 'react'
import { MessageCircle, ListTodo } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/lib/i18n/client'

interface ChatToggleProps {
  activePanel: 'tasks' | 'chat'
  onToggle: (panel: 'tasks' | 'chat') => void
  unreadCount?: number
}

export const ChatToggle = React.memo(function ChatToggle({
  activePanel,
  onToggle,
  unreadCount = 0,
}: ChatToggleProps) {
  const { t } = useTranslations()
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onToggle(activePanel === 'tasks' ? 'chat' : 'tasks')}
      className="p-2 relative"
      title={activePanel === 'tasks' ? t('chat.openChat') : t('chat.showTasks')}
    >
      {activePanel === 'tasks' ? (
        <>
          <MessageCircle className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-danger text-danger-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </>
      ) : (
        <ListTodo className="w-5 h-5" />
      )}
    </Button>
  )
})
