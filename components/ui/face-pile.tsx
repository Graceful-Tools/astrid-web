"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { User } from "@/types/task"

interface FacePileProps {
  users: User[]
  maxVisible?: number
  size?: "sm" | "md" | "lg"
  className?: string
}

export function FacePile({ users = [], maxVisible = 3, size = "sm", className = "" }: FacePileProps) {
  if (users.length === 0) return null
  
  const visibleUsers = users.slice(0, maxVisible)
  const remainingCount = Math.max(0, users.length - maxVisible)
  
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6", 
    lg: "w-8 h-8"
  }
  
  const textSizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base"
  }
  
  return (
    <div className={`flex items-center -space-x-1 ${className}`}>
      {visibleUsers.map((user, index) => (
        <Avatar 
          key={user.id} 
          className={`${sizeClasses[size]} border border-theme ${user.isPending ? 'opacity-60' : ''}`}
          style={{ zIndex: visibleUsers.length - index }}
        >
          <AvatarImage src={user.image || "/placeholder.svg"} />
          <AvatarFallback className={`${textSizeClasses[size]} bg-theme-active text-theme-secondary`}>
            {user.name?.charAt(0) || user.email.charAt(0)}
          </AvatarFallback>
        </Avatar>
      ))}
      {remainingCount > 0 && (
        <div 
          className={`${sizeClasses[size]} border border-theme bg-theme-tertiary text-theme-secondary rounded-full flex items-center justify-center ${textSizeClasses[size]} font-medium`}
          style={{ zIndex: 0 }}
        >
          +{remainingCount}
        </div>
      )}
    </div>
  )
}