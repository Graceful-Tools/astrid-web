import { useEffect, useRef, useState } from "react"

export interface UsePanelArrowPositionOptions {
  sourceSelector: string
  getPanelElement: () => HTMLElement | null
  initialTop?: number
  arrowOffset?: number
  minTop?: number
  maxTopInset?: number
}

export function usePanelArrowPosition({
  sourceSelector,
  getPanelElement,
  initialTop = 80,
  arrowOffset = 10,
  minTop = 20,
  maxTopInset = 40,
}: UsePanelArrowPositionOptions): number {
  const [arrowTop, setArrowTop] = useState(initialTop)
  const getPanelRef = useRef(getPanelElement)
  getPanelRef.current = getPanelElement

  useEffect(() => {
    const updateArrowPosition = () => {
      try {
        const sourceCard = document.querySelector(sourceSelector) as HTMLElement | null
        const panelElement = getPanelRef.current()
        if (!sourceCard || !panelElement) return

        const cardRect = sourceCard.getBoundingClientRect()
        const panelRect = panelElement.getBoundingClientRect()
        if (cardRect.height <= 0) return

        const cardCenter = cardRect.top + cardRect.height / 2
        const relativePosition = cardCenter - panelRect.top
        const maxTop = panelRect.height - maxTopInset
        const finalTop = Math.max(minTop, Math.min(maxTop, relativePosition - arrowOffset))
        setArrowTop(finalTop)
      } catch {
        // DOM queries occasionally throw during unmount races — ignore.
      }
    }

    updateArrowPosition()
    const rafId = requestAnimationFrame(updateArrowPosition)

    const sourceCard = document.querySelector(sourceSelector) as HTMLElement | null
    const scrollContainer = sourceCard?.closest('.overflow-y-auto') ?? null
    scrollContainer?.addEventListener('scroll', updateArrowPosition, { passive: true })

    window.addEventListener('resize', updateArrowPosition, { passive: true })

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateArrowPosition)
      const panelElement = getPanelRef.current()
      if (panelElement) resizeObserver.observe(panelElement)
      if (sourceCard) resizeObserver.observe(sourceCard)
    }

    return () => {
      cancelAnimationFrame(rafId)
      scrollContainer?.removeEventListener('scroll', updateArrowPosition)
      window.removeEventListener('resize', updateArrowPosition)
      resizeObserver?.disconnect()
    }
  }, [sourceSelector, arrowOffset, minTop, maxTopInset])

  return arrowTop
}
