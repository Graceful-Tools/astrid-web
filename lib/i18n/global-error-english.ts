/**
 * The crash page's words before its locale's are loaded, and if they cannot be (AWTD-1613).
 * Kept apart from lib/i18n/global-error-messages.ts so that only these four strings, not all
 * twelve locales, ride in every route's first load with app/global-error.tsx.
 */
export interface GlobalErrorMessages {
  /** errorPages.globalErrorTitle */
  title: string
  /** errorPages.globalErrorDescription */
  description: string
  /** errorPages.tryAgain */
  tryAgain: string
  /** errorPages.goHome */
  goHome: string
}

export const GLOBAL_ERROR_ENGLISH: GlobalErrorMessages = {
  title: 'Something went wrong',
  description: 'A critical error occurred. Please try refreshing the page.',
  tryAgain: 'Try again',
  goHome: 'Go home',
}
