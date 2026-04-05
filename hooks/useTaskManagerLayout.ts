import { useState, useEffect, useRef, useCallback } from "react"
import { useSwipe } from "@/hooks/use-swipe"
import { useSwipeToDismiss } from "@/hooks/use-swipe-to-dismiss"
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh"
import {
  getLayoutType,
  shouldShowHamburgerMenu,
  is1ColumnView,
  is2ColumnView,
  is3ColumnView,
  getColumnCount,
  isMobileDevice,
  type LayoutType
} from "@/lib/layout-detection"

interface UseTaskManagerLayoutProps {
  onRefresh?: () => Promise<void>
  onSearchClear?: () => void
}

export function useTaskManagerLayout({ onRefresh, onSearchClear }: UseTaskManagerLayoutProps) {
  // Layout state — initialize from actual window size to avoid hydration mismatch
  const [layoutType, setLayoutType] = useState<LayoutType>(() => getLayoutType())
  const [isMobile, setIsMobile] = useState(() => is1ColumnView(getLayoutType()))
  const [mobileView, setMobileView] = useState<'list' | 'task' | 'chat'>('list')
  const [activePanel, setActivePanel] = useState<'tasks' | 'chat'>('tasks')
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(() => shouldShowHamburgerMenu(getLayoutType()))
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)
  const [mobileSearchMode, setMobileSearchMode] = useState(false)
  const [justReturnedFromTaskDetail, setJustReturnedFromTaskDetail] = useState(false)

  // Mobile task detail animation state
  const [isMobileTaskDetailClosing, setIsMobileTaskDetailClosing] = useState(false)
  const [isMobileTaskDetailOpen, setIsMobileTaskDetailOpen] = useState(false)

  // Swipe-to-dismiss drag state for real-time feedback
  const [taskDetailDragOffset, setTaskDetailDragOffset] = useState(0)

  // Refs
  const taskManagerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Layout detection
  useEffect(() => {
    const updateLayout = () => {
      const currentLayoutType = getLayoutType()
      const mobile = is1ColumnView(currentLayoutType)
      const hamburgerMenu = shouldShowHamburgerMenu(currentLayoutType)

      // Reset activePanel when transitioning to mobile — in 2-column and
      // 3-column, chat is always visible as a right column, but in mobile
      // activePanel='chat' replaces the task list entirely
      const wasDesktop = !is1ColumnView(layoutType)
      const nowMobile = is1ColumnView(currentLayoutType)
      if (wasDesktop && nowMobile) {
        setActivePanel('tasks')
      }

      setLayoutType(currentLayoutType)
      setIsMobile(mobile)
      setShowHamburgerMenu(hamburgerMenu)
    }

    updateLayout()

    let resizeTimeout: NodeJS.Timeout
    const handleResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(updateLayout, 100)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      clearTimeout(resizeTimeout)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  // Outside click handler for mobile sidebar
  useEffect(() => {
    if (!showMobileSidebar) {
      return
    }

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Element
      const sidebar = sidebarRef.current
      const hamburgerButton = document.querySelector('[data-hamburger-button]')

      if (
        sidebar &&
        !sidebar.contains(target) &&
        hamburgerButton &&
        !hamburgerButton.contains(target)
      ) {
        setShowMobileSidebar(false)
      }
    }

    // Handle both mouse and touch events for proper mobile/tablet support
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchend', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchend', handleClickOutside)
    }
  }, [showMobileSidebar, showHamburgerMenu])

  // Trigger slide-in animation when task detail opens
  useEffect(() => {
    if (mobileView === 'task') {
      // Wait one frame for the element to render at initial position, then animate in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsMobileTaskDetailOpen(true)
        })
      })
    } else {
      setIsMobileTaskDetailOpen(false)
    }
  }, [mobileView])

  // Mobile navigation handlers
  const toggleMobileSidebar = useCallback(() => {
    setShowMobileSidebar(prev => !prev)
  }, [])

  const handleMobileBack = useCallback(() => {
    if (mobileView === 'task') {
      setIsMobileTaskDetailOpen(false) // Reset for next time
      setIsMobileTaskDetailClosing(true)
      setTimeout(() => {
        setMobileView('list')
        setJustReturnedFromTaskDetail(true)
        setIsMobileTaskDetailClosing(false)
        setTimeout(() => setJustReturnedFromTaskDetail(false), 500)
      }, 350) // Match animation duration (0.35s)
    } else if (mobileView === 'chat') {
      setMobileView('list')
    }
  }, [mobileView])

  // Mobile search handlers
  const handleMobileSearchStart = useCallback(() => {
    setMobileSearchMode(true)
  }, [])

  const handleMobileSearchEnd = useCallback(() => {
    setMobileSearchMode(false)
  }, [])

  const handleMobileSearchClear = useCallback(() => {
    setMobileSearchMode(false)
    onSearchClear?.()
  }, [onSearchClear])

  const handleMobileSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setMobileSearchMode(false)
      onSearchClear?.()
    }
  }, [onSearchClear])

  // Swipe handlers for mobile navigation
  const swipeHandlers = useSwipe({
    onSwipeLeft: () => {
      if (isMobile && mobileView === 'list' && !showMobileSidebar) {
        setMobileView('task')
      }
    },
    onSwipeRight: () => {
      // Only handle right swipes when in list view (not when in task view - task detail handles those)
      if (isMobile && mobileView === 'list' && !showMobileSidebar) {
        setShowMobileSidebar(true)
      }
    }
  }, {
    threshold: 50,
    trackTouch: isMobileDevice()
  })

  // Swipe-to-dismiss handlers for mobile sidebar
  const sidebarSwipeToDismiss = useSwipeToDismiss({
    onDismiss: () => {
      if (showMobileSidebar) {
        setShowMobileSidebar(false)
      }
    }
  }, {
    direction: 'left',
    threshold: 60,
    trackTouch: isMobileDevice() && showMobileSidebar
  })

  // Swipe-to-dismiss handlers for task detail panel (right swipe only)
  const taskDetailSwipeToDismiss = useSwipe({
    onSwipeRight: () => {
      if (isMobile && mobileView === 'task') {
        setTaskDetailDragOffset(0) // Reset before closing
        handleMobileBack()
      }
    },
    // Real-time drag feedback - panel follows finger
    onSwipeProgress: (deltaX) => {
      if (isMobile && mobileView === 'task' && deltaX > 0) {
        setTaskDetailDragOffset(deltaX)
      }
    },
    // Spring back if swipe wasn't completed
    onSwipeCancel: () => {
      setTaskDetailDragOffset(0)
    }
  }, {
    threshold: 50,
    trackTouch: isMobileDevice() && mobileView === 'task'
  })

  // Pull-to-refresh functionality
  const pullToRefresh = usePullToRefresh({
    threshold: 60,
    onRefresh: onRefresh || (() => Promise.resolve()),
    disabled: !isMobile || mobileView !== 'list'
  })

  return {
    // Layout information
    layoutType,
    columnCount: getColumnCount(layoutType),
    is1Column: is1ColumnView(layoutType),
    is2Column: is2ColumnView(layoutType),
    is3Column: is3ColumnView(layoutType),

    // State
    isMobile,
    mobileView,
    showHamburgerMenu,
    showMobileSidebar,
    mobileSearchMode,
    justReturnedFromTaskDetail,
    isMobileTaskDetailClosing,
    isMobileTaskDetailOpen,
    taskDetailDragOffset,

    // Refs
    taskManagerRef,
    sidebarRef,

    // Utilities
    swipeHandlers,
    sidebarSwipeToDismiss,
    taskDetailSwipeToDismiss,
    pullToRefresh,

    // State setters
    activePanel,
    setActivePanel,
    setMobileView,
    setShowMobileSidebar,
    setMobileSearchMode,
    setJustReturnedFromTaskDetail,

    // Handlers
    toggleMobileSidebar,
    handleMobileBack,
    handleMobileSearchStart,
    handleMobileSearchEnd,
    handleMobileSearchClear,
    handleMobileSearchKeyDown,
  }
}
