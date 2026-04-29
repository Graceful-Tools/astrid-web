/**
 * Unified Layout Detection System
 *
 * This module provides centralized device and layout detection logic
 * used throughout the application to determine optimal UI layouts.
 */

export type LayoutType =
  | 'mobile-1-column'    // iPhone/Android phone
  | 'tablet-2-column'    // iPad portrait
  | 'tablet-3-column'    // iPad landscape
  | 'computer-1-column'  // Desktop narrow window
  | 'computer-2-column'  // Desktop medium window
  | 'computer-3-column'  // Desktop wide window

export type DeviceType = 'mobile' | 'tablet' | 'computer'
export type ColumnCount = 1 | 2 | 3

/**
 * Detect if the current device is a mobile phone
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false

  return (
    window.navigator.userAgent.includes('Mobile') ||
    window.navigator.userAgent.includes('Android') ||
    /iPhone|iPod/.test(window.navigator.userAgent)
  )
}

/**
 * Detect if the current device is an iPad
 */
export function isIPadDevice(): boolean {
  if (typeof window === 'undefined') return false

  return (
    /iPad/.test(window.navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  )
}

/**
 * Get the current window width, with fallback for SSR
 */
export function getWindowWidth(): number {
  return typeof window !== 'undefined' ? window.innerWidth : 1200
}

/**
 * Determine the current layout type based on device and window size.
 *
 * Order matters: iPad must be checked BEFORE mobile, because every iPad
 * Safari user agent contains the substring "Mobile/..." (Apple's convention),
 * which makes isMobileDevice() match. If we let the mobile branch run first,
 * iPad-portrait users land in mobile-1-column even though they should see
 * tablet-2-column.
 */
export function getLayoutType(): LayoutType {
  const width = getWindowWidth()
  const isMobile = isMobileDevice()
  const isIPad = isIPadDevice()

  if (isIPad && width >= 1100) {
    return 'tablet-3-column'
  } else if (isIPad) {
    return 'tablet-2-column'
  } else if (isMobile && width < 910) {
    return 'mobile-1-column'
  } else if (!isMobile && width < 910) {
    return 'computer-1-column'
  } else if (!isMobile && width >= 910 && width < 1100) {
    return 'computer-2-column'
  } else if (!isMobile && width >= 1100) {
    return 'computer-3-column'
  }

  // Fallback
  return 'computer-2-column'
}

/**
 * Extract device type from layout type
 */
export function getDeviceType(layoutType?: LayoutType): DeviceType {
  const layout = layoutType || getLayoutType()

  if (layout.startsWith('mobile-')) return 'mobile'
  if (layout.startsWith('tablet-')) return 'tablet'
  return 'computer'
}

/**
 * Extract column count from layout type
 */
export function getColumnCount(layoutType?: LayoutType): ColumnCount {
  const layout = layoutType || getLayoutType()

  if (layout.endsWith('-1-column')) return 1
  if (layout.endsWith('-2-column')) return 2
  return 3
}

/**
 * Check if current layout is a single column view
 */
export function is1ColumnView(layoutType?: LayoutType): boolean {
  return getColumnCount(layoutType) === 1
}

/**
 * Check if current layout is a two column view
 */
export function is2ColumnView(layoutType?: LayoutType): boolean {
  return getColumnCount(layoutType) === 2
}

/**
 * Check if current layout is a three column view
 */
export function is3ColumnView(layoutType?: LayoutType): boolean {
  return getColumnCount(layoutType) === 3
}

/**
 * Check if hamburger menu should be shown (for layouts with limited space)
 */
export function shouldShowHamburgerMenu(layoutType?: LayoutType): boolean {
  const layout = layoutType || getLayoutType()
  return layout === 'mobile-1-column' ||
         layout === 'computer-1-column' ||
         layout === 'computer-2-column' ||
         layout === 'tablet-2-column'
}

// ===== MOBILE FORM INTERACTION HELPERS =====

/**
 * Enhanced mobile device detection that includes iPhone/iPod specifically
 */
export function isMobilePhoneDevice(): boolean {
  if (typeof window === 'undefined') return false

  return (
    window.navigator.userAgent.includes('Mobile') ||
    window.navigator.userAgent.includes('Android') ||
    /iPhone|iPod/.test(window.navigator.userAgent)
  )
}

/**
 * Detect if device is a touch device
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

/**
 * Enhanced device detection for form interactions
 * Combines multiple signals to determine if special mobile form handling is needed
 */
export function needsMobileFormHandling(): boolean {
  if (typeof window === 'undefined') return false

  const userAgent = window.navigator.userAgent
  const hasTouch = isTouchDevice()
  const isSmallScreen = window.innerWidth <= 768
  const isMobileUA = /Mobile|Android|iPhone|iPod|BlackBerry|Opera Mini/i.test(userAgent)

  return isMobileUA || (hasTouch && isSmallScreen) || isIPadDevice()
}

/**
 * Check if current environment needs special iOS form handling
 */
export function needsIOSFormHandling(): boolean {
  if (typeof window === 'undefined') return false

  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  )
}

/**
 * Get appropriate keyboard detection threshold based on device
 */
export function getKeyboardDetectionThreshold(): number {
  // iPad needs a lower threshold due to different keyboard behavior
  return isIPadDevice() ? 100 : 150
}

/**
 * Check if auto-focus should be prevented on current device
 * Touch devices generally need user gesture to trigger focus properly
 */
export function shouldPreventAutoFocus(): boolean {
  return needsMobileFormHandling()
}

/**
 * Check if aggressive keyboard protection is needed
 * Some devices (especially iPad) need extra protection against accidental form dismissal
 */
export function needsAggressiveKeyboardProtection(): boolean {
  return isIPadDevice()
}

/**
 * Check if touch events should be ignored during keyboard interactions
 */
export function shouldIgnoreTouchDuringKeyboard(): boolean {
  return isIPadDevice()
}

/**
 * Check if special scroll-into-view handling is needed for form inputs
 */
export function needsScrollIntoViewHandling(): boolean {
  return needsIOSFormHandling()
}

/**
 * Get focus time threshold for preventing accidental dismissals (in milliseconds)
 */
export function getFocusProtectionThreshold(): number {
  // iPad needs longer protection due to touch interaction patterns
  return isIPadDevice() ? 500 : 300
}