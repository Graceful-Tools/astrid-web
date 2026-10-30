import type { User } from "@/types/task"

/**
 * Helper functions for displaying user information with fallbacks for deleted users
 */

/** Only what a display name is made of. Email is optional: the API withholds
 *  it on other people's profiles (AWTD-1419). */
type Displayable = Pick<User, "name"> & { email?: string | null }

export function getUserDisplay(user: Displayable | null | undefined): string {
  if (!user) return "Deleted User"
  return user.name || user.email || "Unknown User"
}

export function getUserInitial(user: Displayable | null | undefined): string {
  if (!user) return "?"
  const display = user.name || user.email || "?"
  return display.charAt(0).toUpperCase()
}

export function getUserEmail(user: User | null | undefined): string {
  if (!user) return "deleted@user.com"
  return user.email || "unknown@user.com"
}

export function getUserId(user: User | null | undefined): string | null {
  if (!user) return null
  return user.id || null
}
