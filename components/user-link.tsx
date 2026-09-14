"use client"

import Link from "next/link"
import { getUserDisplay, getUserInitial } from "@/lib/user-display"
import { ProfileImage } from "@/components/ui/profile-image"
import type { User } from "@/types/task"

interface UserLinkProps {
  user: User | null | undefined
  showAvatar?: boolean
  avatarSize?: "sm" | "md" | "lg"
  className?: string
  children?: React.ReactNode
}

/**
 * UserLink - Reusable component for displaying clickable user links
 *
 * Renders a link to the user's profile page with optional avatar
 * Handles deleted/null users gracefully
 */
export function UserLink({
  user,
  showAvatar = false,
  avatarSize = "sm",
  className = "",
  children,
}: UserLinkProps) {
  // Handle deleted or null users
  if (!user || !user.id) {
    const displayName = getUserDisplay(user)
    return (
      <span className={`theme-text-muted ${className}`}>
        {showAvatar && (
          <ProfileImage
            src={null}
            alt="Unknown user"
            fallback="?"
            size={avatarSize}
          />
        )}
        {children || displayName}
      </span>
    )
  }

  const displayName = getUserDisplay(user)
  const userInitial = getUserInitial(user)

  return (
    <Link
      href={`/u/${user.id}`}
      className={`inline-flex items-center gap-2 hover:underline theme-text-primary transition-colors ${className}`}
      onClick={(e) => {
        // Stop propagation to prevent parent click handlers
        e.stopPropagation()
      }}
    >
      {showAvatar && (
        <ProfileImage
          src={user.image}
          alt={displayName}
          fallback={userInitial}
          size={avatarSize}
        />
      )}
      <span>{children || displayName}</span>
    </Link>
  )
}

