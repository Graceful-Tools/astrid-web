"use client"

/**
 * Which column layout the viewport is showing. Lived in
 * enhanced-task-creation.tsx until task f699462a retired that component; it is
 * a viewport concern rather than an add-task one, so it moved here instead of
 * following the input into components/quick-add.tsx.
 */

import { useEffect, useState } from 'react'
import type { LayoutType } from '@/lib/quick-add'

export function useLayoutType(): LayoutType {
  const [layoutType, setLayoutType] = useState<LayoutType>('1-column')

  useEffect(() => {
    const updateLayoutType = () => {
      const width = window.innerWidth
      if (width >= 1200) {
        setLayoutType('3-column')
      } else if (width >= 768) {
        setLayoutType('2-column')
      } else {
        setLayoutType('1-column')
      }
    }

    updateLayoutType()
    window.addEventListener('resize', updateLayoutType)
    return () => window.removeEventListener('resize', updateLayoutType)
  }, [])

  return layoutType
}
