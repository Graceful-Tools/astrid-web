"use client"

import { getListImageUrl, getConsistentDefaultImage } from "@/lib/default-images"
import { useListImagesVisibility } from "@/contexts/list-images-context"
import type { TaskList } from "@/types/task"

/**
 * The list header's 64px image — or, under hide_list_images, nothing: no
 * image, nothing to pick, and no glyph either. The header's width goes to the
 * list's name, which a glyph there used to squeeze into "Astrid Web T…"
 * beside the view toggle and buttons (AWTD-1155).
 */
export function ListHeaderImage({ list, onPick }: { list: TaskList; onPick?: () => void }) {
  const { showListImages } = useListImagesVisibility()
  if (!showListImages) return null

  return (
    <img
      src={getListImageUrl(list)}
      alt={list.name}
      className={`w-16 h-16 rounded-xl object-cover flex-shrink-0 ${onPick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
      onClick={onPick}
      title={onPick ? "Click to change image" : list.name}
      onError={(e) => {
        // Fallback to consistent default image on error
        const target = e.currentTarget as HTMLImageElement
        const fallbackImage = getConsistentDefaultImage(list.id).filename
        if (target.src !== fallbackImage) {
          target.src = fallbackImage
        }
      }}
    />
  )
}
