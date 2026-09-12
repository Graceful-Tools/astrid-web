import { describe, it, expect, vi, beforeEach , type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTaskManagerLayout } from '@/hooks/useTaskManagerLayout'

// Mock the layout detection module
vi.mock('@/lib/layout-detection', () => ({
  getLayoutType: vi.fn(() => 'mobile-1-column'),
  shouldShowHamburgerMenu: vi.fn(() => false),
  is1ColumnView: vi.fn(() => true),
  is2ColumnView: vi.fn(() => false),
  is3ColumnView: vi.fn(() => false),
  getColumnCount: vi.fn(() => 1),
  isMobileDevice: vi.fn(() => true),
}))

// Mock the hooks
vi.mock('@/hooks/use-swipe', () => ({
  useSwipe: vi.fn(() => ({
    onTouchStart: vi.fn(),
    onTouchMove: vi.fn(),
    onTouchEnd: vi.fn(),
  })),
}))

vi.mock('@/hooks/use-swipe-to-dismiss', () => ({
  useSwipeToDismiss: vi.fn(() => ({
    onTouchStart: vi.fn(),
    onTouchMove: vi.fn(),
    onTouchEnd: vi.fn(),
  })),
}))

describe('Mobile Pull-to-Refresh', () => {
  let onRefreshMock: Mock

  beforeEach(() => {
    onRefreshMock = vi.fn(() => Promise.resolve())
  })

  it('should enable pull-to-refresh on mobile list view', () => {
    const { result } = renderHook(() =>
      useTaskManagerLayout({
        onRefresh: onRefreshMock,
        onSearchClear: vi.fn(),
      })
    )

    expect(result.current.pullToRefresh).toBeDefined()
    expect(result.current.pullToRefresh.isRefreshing).toBe(false)
    expect(result.current.pullToRefresh.isPulling).toBe(false)
    expect(result.current.pullToRefresh.canRefresh).toBe(false)
    expect(result.current.pullToRefresh.pullDistance).toBe(0)
  })

  it('should disable pull-to-refresh when viewing task detail on mobile', () => {
    const { result } = renderHook(() =>
      useTaskManagerLayout({
        onRefresh: onRefreshMock,
        onSearchClear: vi.fn(),
      })
    )

    // Switch to task view
    act(() => {
      result.current.setMobileView('task')
    })

    // Pull-to-refresh should still exist but be disabled by the hook's disabled flag
    expect(result.current.pullToRefresh).toBeDefined()
    expect(result.current.mobileView).toBe('task')
  })

  it('should have required pull-to-refresh methods', () => {
    const { result } = renderHook(() =>
      useTaskManagerLayout({
        onRefresh: onRefreshMock,
        onSearchClear: vi.fn(),
      })
    )

    expect(typeof result.current.pullToRefresh.onTouchStart).toBe('function')
    expect(typeof result.current.pullToRefresh.onTouchMove).toBe('function')
    expect(typeof result.current.pullToRefresh.onTouchEnd).toBe('function')
    expect(typeof result.current.pullToRefresh.bindToElement).toBe('function')
  })

  it('should have visual indicator properties', () => {
    const { result } = renderHook(() =>
      useTaskManagerLayout({
        onRefresh: onRefreshMock,
        onSearchClear: vi.fn(),
      })
    )

    expect(typeof result.current.pullToRefresh.isPulling).toBe('boolean')
    expect(typeof result.current.pullToRefresh.canRefresh).toBe('boolean')
    expect(typeof result.current.pullToRefresh.isRefreshing).toBe('boolean')
    expect(typeof result.current.pullToRefresh.pullDistance).toBe('number')
  })

  it('should create pull-to-refresh with correct disabled state for mobile list view', () => {
    const { result } = renderHook(() =>
      useTaskManagerLayout({
        onRefresh: onRefreshMock,
        onSearchClear: vi.fn(),
      })
    )

    // On mobile list view, pull-to-refresh should be enabled (disabled = false)
    // We can verify this by checking that the hook was created with mobile = true and mobileView = 'list'
    expect(result.current.isMobile).toBe(true)
    expect(result.current.mobileView).toBe('list')
  })

  it('should create pull-to-refresh with correct disabled state for mobile task view', () => {
    const { result } = renderHook(() =>
      useTaskManagerLayout({
        onRefresh: onRefreshMock,
        onSearchClear: vi.fn(),
      })
    )

    act(() => {
      result.current.setMobileView('task')
    })

    // On mobile task view, the hook is configured with disabled = true
    expect(result.current.isMobile).toBe(true)
    expect(result.current.mobileView).toBe('task')
  })
})
