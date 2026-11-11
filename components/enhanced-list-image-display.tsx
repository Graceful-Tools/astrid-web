"use client"

import React, { useCallback, useState } from 'react'
import { Edit3, ImageIcon } from "lucide-react"
import { getListImageUrl, getConsistentDefaultImage } from "@/lib/default-images"
import type { TaskList } from '@/types/task'

export type ImageDisplaySize = 'thumbnail' | 'small' | 'medium' | 'large'

interface EnhancedListImageDisplayProps {
  list: TaskList
  canEdit: boolean
  onImageClick?: () => void
  size?: ImageDisplaySize
  showEditOverlay?: boolean
  className?: string
  alt?: string
}

type ImageState = 'loading' | 'loaded' | 'error'

export function EnhancedListImageDisplay({
  list,
  canEdit,
  onImageClick,
  size = "thumbnail",
  showEditOverlay = true,
  className = "",
  alt
}: EnhancedListImageDisplayProps) {
  const [imageState, setImageState] = useState<ImageState>('loading')

  // Get size-specific CSS classes
  const getSizeClasses = (imageSize: ImageDisplaySize): string => {
    switch (imageSize) {
      case 'thumbnail':
        return 'w-5 h-5'
      case 'small':
        return 'w-8 h-8'
      case 'medium':
        return 'w-12 h-12'
      case 'large':
        return 'w-16 h-16'
      default:
        return 'w-5 h-5'
    }
  }

  // Enhanced click handler with proper event handling
  const handleImageClick = useCallback((e: React.MouseEvent) => {
    // Prevent any event bubbling that might interfere
    e.preventDefault()
    e.stopPropagation()

    if (canEdit && onImageClick) {
      console.log('🖼️ Enhanced image click handler triggered', {
        listId: list.id,
        listName: list.name,
        canEdit,
        hasClickHandler: !!onImageClick,
        imageState,
        timestamp: new Date().toISOString()
      })
      onImageClick()
    } else {
      console.log('🚫 Image click ignored', {
        canEdit,
        hasClickHandler: !!onImageClick,
        reason: !canEdit ? 'No edit permission' : 'No click handler'
      })
    }
  }, [canEdit, onImageClick, list.id, list.name, imageState])

  // Enhanced error handling
  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.currentTarget
    const originalSrc = target.src

    // Get the default image URL directly (bypassing custom images)
    const defaultFallback = getConsistentDefaultImage(list.id).filename

    console.warn('🖼️ Image failed to load, falling back to default', {
      listId: list.id,
      originalSrc,
      fallbackSrc: defaultFallback
    })

    // Only set fallback if we haven't already tried it
    if (originalSrc !== defaultFallback) {
      target.src = defaultFallback
      setImageState('loaded') // Assume fallback will work
    } else {
      setImageState('error')
    }
  }, [list.id])

  // Get the image source with fallback
  const getImageSrc = (): string => {
    return getListImageUrl(list)
  }

  // Generate container classes
  const getContainerClasses = (): string => {
    const baseClasses = `relative ${getSizeClasses(size)} group rounded-lg overflow-hidden transition-all duration-medium`
    const interactiveClasses = canEdit
      ? 'cursor-pointer hover:scale-105 hover:shadow-md'
      : 'cursor-default'

    return `${baseClasses} ${interactiveClasses} ${className}`
  }

  // Generate image classes
  const getImageClasses = (): string => {
    const baseClasses = `
      w-full h-full object-cover transition-all duration-medium
      ${imageState === 'loading' ? 'animate-pulse bg-theme-active' : ''}
      ${canEdit ? 'group-hover:brightness-90' : ''}
    `

    return baseClasses.trim()
  }

  return (
    <div className={getContainerClasses()}>
      {/* Main Image */}
      <img
        src={getImageSrc()}
        alt={alt || `${list.name} list image`}
        className={getImageClasses()}
        onClick={handleImageClick}
        onLoad={() => setImageState('loaded')}
        onError={handleImageError}
        // Add additional attributes for better accessibility
        role={canEdit ? 'button' : 'img'}
        tabIndex={canEdit ? 0 : -1}
        onKeyDown={canEdit ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleImageClick(e as any)
          }
        } : undefined}
        title={canEdit ? `Click to change image for ${list.name}` : `${list.name} list image`}
      />

      {/* Edit Overlay */}
      {canEdit && showEditOverlay && (
        <div
          className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-hover flex items-center justify-center cursor-pointer"
          onClick={handleImageClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleImageClick(e as any)
            }
          }}
          title={`Click to change image for ${list.name}`}
        >
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-hover bg-white/90 rounded-full p-1 pointer-events-none">
            <Edit3 className="w-3 h-3 text-gray-700" />
          </div>
        </div>
      )}

      {/* Loading State */}
      {imageState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-theme-tertiary">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand"></div>
        </div>
      )}

      {/* Error State */}
      {imageState === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-theme-tertiary">
          <ImageIcon className="w-3 h-3 text-theme-muted" />
        </div>
      )}

      {/* Accessibility hint for screen readers */}
      {canEdit && (
        <span className="sr-only">
          Press Enter or Space to change the image for {list.name}
        </span>
      )}
    </div>
  )
}

// Helper function to create a simple image display without all the enhanced features
export function SimpleListImageDisplay({
  list,
  size = "thumbnail",
  className = "",
  alt
}: Pick<EnhancedListImageDisplayProps, 'list' | 'size' | 'className' | 'alt'>) {
  return (
    <EnhancedListImageDisplay
      list={list}
      canEdit={false}
      size={size}
      showEditOverlay={false}
      className={className}
      alt={alt}
    />
  )
}

export default EnhancedListImageDisplay