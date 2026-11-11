"use client"

import * as React from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { preloadImage, isImageCached } from "@/lib/image-cache"

interface ProfileImageProps {
  src: string | null | undefined
  alt: string
  fallback?: string
  size?: "xs" | "sm" | "md" | "lg" | "xl"
  className?: string
  priority?: boolean
}

const sizeMap = {
  xs: { dimension: 24, text: "text-[10px]" },
  sm: { dimension: 32, text: "text-xs" },
  md: { dimension: 40, text: "text-sm" },
  lg: { dimension: 64, text: "text-base" },
  xl: { dimension: 80, text: "text-xl" },
}

/**
 * ProfileImage - Optimized profile photo component
 *
 * Features:
 * - Client-side memory cache for instant re-renders
 * - Lazy loading by default
 * - Proper sizing to prevent layout shift
 * - Browser caching via HTTP headers
 */
export function ProfileImage({
  src,
  alt,
  fallback,
  size = "sm",
  className,
  priority = false,
}: ProfileImageProps) {
  const [hasError, setHasError] = React.useState(false)
  const [isLoaded, setIsLoaded] = React.useState(() => src ? isImageCached(src) : false)
  const { dimension, text } = sizeMap[size]

  // Reset error state and check cache when src changes
  React.useEffect(() => {
    setHasError(false)
    if (src) {
      setIsLoaded(isImageCached(src))
      // Preload into memory cache
      preloadImage(src).then(() => setIsLoaded(true))
    }
  }, [src])

  // Show fallback if no src or error loading
  if (!src || hasError) {
    return (
      <div
        className={cn(
          "rounded-full bg-theme-active flex items-center justify-center shrink-0",
          className
        )}
        style={{ width: dimension, height: dimension }}
      >
        <span className={cn("font-medium text-theme-secondary", text)}>
          {fallback || "?"}
        </span>
      </div>
    )
  }

  // External images (OAuth providers) - use img tag with loading optimization
  // Next.js Image doesn't support arbitrary external domains without config
  const isExternal = src.startsWith("http") && !src.includes(process.env.NEXT_PUBLIC_APP_URL || "")

  if (isExternal) {
    return (
      <img
        src={src}
        alt={alt}
        width={dimension}
        height={dimension}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onError={() => setHasError(true)}
        className={cn(
          "rounded-full object-cover shrink-0",
          className
        )}
        style={{ width: dimension, height: dimension }}
      />
    )
  }

  // Internal images - use Next.js Image for optimization
  return (
    <Image
      src={src}
      alt={alt}
      width={dimension}
      height={dimension}
      priority={priority}
      onError={() => setHasError(true)}
      className={cn(
        "rounded-full object-cover shrink-0",
        className
      )}
    />
  )
}

/**
 * Get initials from a name or email
 */
export function getInitials(nameOrEmail: string | null | undefined): string {
  if (!nameOrEmail) return "?"

  // If it's an email, use first character
  if (nameOrEmail.includes("@")) {
    return nameOrEmail.charAt(0).toUpperCase()
  }

  // For names, use first letter of first and last words
  const parts = nameOrEmail.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }

  return nameOrEmail.substring(0, 2).toUpperCase()
}
