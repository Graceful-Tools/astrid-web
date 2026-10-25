/**
 * Whether list images are drawn — the hide_list_images A/B test.
 *
 * Production, 2026-10-07: 381 of 400 list images were the auto-assigned
 * /icons/default_list_N.png, and only 9 users had ever chosen one. The
 * experiment hides images (sidebar, list header, list settings, public list
 * browser) for the flag's rollout; "Show list images" in Settings → Appearance
 * lets anyone override it either way.
 *
 * Shared by the web provider (contexts/list-images-context.tsx) and the
 * read-only experiment report, so both decide the same way. iOS reads the same
 * two inputs: `hide_list_images` from GET /api/v1/features and
 * `showListImages` from GET /api/v1/users/me/smart-tasks.
 */

export const HIDE_LIST_IMAGES_FEATURE_KEY = 'hide_list_images' as const

/**
 * @param preference User.showListImages — null/undefined means "follow the
 *   experiment"; an explicit true/false is the user's choice and always wins.
 * @param hideFlag whether hide_list_images evaluated ON for this user.
 */
export function shouldShowListImages(
  preference: boolean | null | undefined,
  hideFlag: boolean,
): boolean {
  return preference ?? !hideFlag
}
