// Default list images configuration
// These use placeholder images that can be replaced with AI-generated ones

import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'

export interface DefaultListImage {
  name: string
  filename: string
  theme: string
  color: string
  description: string
}

export const DEFAULT_LIST_IMAGES: DefaultListImage[] = [
  { 
    name: "Default List 0", 
    filename: "/icons/default_list_0.png", 
    theme: "default", 
    color: DEFAULT_LIST_COLOR,
    description: "Default list icon"
  },
  { 
    name: "Default List 1", 
    filename: "/icons/default_list_1.png", 
    theme: "default", 
    color: "#10b981",
    description: "Default list icon"
  },
  { 
    name: "Default List 2", 
    filename: "/icons/default_list_2.png", 
    theme: "default", 
    color: "#f59e0b",
    description: "Default list icon"
  },
  { 
 name: "Default List 3", 
    filename: "/icons/default_list_3.png", 
    theme: "default", 
    color: "#8b5cf6",
    description: "Default list icon"
  }
]

export function getRandomDefaultImage(): DefaultListImage {
  return DEFAULT_LIST_IMAGES[Math.floor(Math.random() * DEFAULT_LIST_IMAGES.length)]
}

// Simple hash function to convert string to number
function simpleHash(str: string): number {
  // Handle undefined/null strings
  if (!str || typeof str !== 'string') {
    return 0
  }

  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

// Get a consistent default image for a list based on its ID
export function getConsistentDefaultImage(listId: string): DefaultListImage {
  // Handle undefined/null listId
  if (!listId || typeof listId !== 'string') {
    return DEFAULT_LIST_IMAGES[0] // Return first default image
  }

  const hash = simpleHash(listId)
  const index = hash % DEFAULT_LIST_IMAGES.length
  return DEFAULT_LIST_IMAGES[index]
}

// Helper function to get the image URL for a list, with consistent fallback
export function getListImageUrl(list: { id: string; imageUrl?: string | null; coverImageUrl?: string | null }): string {
  return list.imageUrl || list.coverImageUrl || getConsistentDefaultImage(list.id).filename
}

export function getDefaultImageByListName(listName: string): DefaultListImage | undefined {
  // Since we now use generic default icons, always return a random one
  return getRandomDefaultImage()
}