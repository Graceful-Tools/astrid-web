"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { isImageCached, preloadImage } from "@/lib/image-cache"

interface AvatarContextValue {
  imageLoaded: boolean
  setImageLoaded: (loaded: boolean) => void
}

const AvatarContext = React.createContext<AvatarContextValue | null>(null)

const Avatar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const [imageLoaded, setImageLoaded] = React.useState(false)

  return (
    <AvatarContext.Provider value={{ imageLoaded, setImageLoaded }}>
      <div
        ref={ref}
        className={cn(
          "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </AvatarContext.Provider>
  )
})
Avatar.displayName = "Avatar"

interface AvatarImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  onLoadingStatusChange?: (status: "loading" | "loaded" | "error") => void
}

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, src, alt, onLoadingStatusChange, ...props }, ref) => {
    const context = React.useContext(AvatarContext)
    const imgRef = React.useRef<HTMLImageElement>(null)
    const [hasError, setHasError] = React.useState(false)

    // Combine refs
    React.useImperativeHandle(ref, () => imgRef.current as HTMLImageElement)

    // setImageLoaded comes from useState, so it is stable; the context object
    // itself is not (it changes whenever imageLoaded flips). The effects below
    // must depend only on src: depending on the context made an offline error
    // (imageLoaded -> false) re-run the reset, clear hasError and re-mount the
    // <img>, which failed again, thousands of times a second (AWTD-1634).
    const setImageLoaded = context?.setImageLoaded
    const onStatusRef = React.useRef(onLoadingStatusChange)
    onStatusRef.current = onLoadingStatusChange

    // Reset error state when src changes
    React.useEffect(() => {
      setHasError(false)
      // Check memory cache first for instant load (only for string URLs)
      if (src && typeof src === 'string' && isImageCached(src)) {
        setImageLoaded?.(true)
        onStatusRef.current?.("loaded")
      } else {
        setImageLoaded?.(false)
      }
    }, [src, setImageLoaded])

    // Check if image is already loaded (from browser cache) after mount
    // Use a separate effect with a microtask to ensure ref is attached
    React.useEffect(() => {
      if (!src) return

      // Use requestAnimationFrame to ensure the img element is in the DOM
      const checkLoaded = () => {
        const img = imgRef.current
        if (img && img.complete && img.naturalWidth > 0) {
          setImageLoaded?.(true)
          onStatusRef.current?.("loaded")
          // Also add to memory cache (only for string URLs)
          if (typeof src === 'string') {
            preloadImage(src)
          }
        }
      }

      // Check immediately and after a frame (for cached images)
      checkLoaded()
      const frameId = requestAnimationFrame(checkLoaded)

      return () => cancelAnimationFrame(frameId)
    }, [src, setImageLoaded])

    // Don't render anything if no src or if there was an error
    if (!src || hasError) {
      return null
    }

    return (
      <img
        ref={imgRef}
        src={src}
        alt={alt || ""}
        className={cn("aspect-square h-full w-full object-cover", className)}
        onLoad={() => {
          context?.setImageLoaded(true)
          onLoadingStatusChange?.("loaded")
        }}
        onError={() => {
          setHasError(true)
          context?.setImageLoaded(false)
          onLoadingStatusChange?.("error")
        }}
        {...props}
      />
    )
  }
)
AvatarImage.displayName = "AvatarImage"

const AvatarFallback = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const context = React.useContext(AvatarContext)

  // Show fallback only when image hasn't loaded
  if (context?.imageLoaded) {
    return null
  }

  return (
    <div
      ref={ref}
      className={cn(
        "flex h-full w-full items-center justify-center rounded-full bg-muted",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
})
AvatarFallback.displayName = "AvatarFallback"

export { Avatar, AvatarImage, AvatarFallback }
