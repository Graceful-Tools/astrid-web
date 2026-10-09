/**
 * Escape user-controlled text for interpolation into an HTML email body.
 *
 * Task titles, list names and display names are typed by users — on a shared
 * list, by OTHER users — so they must reach the recipient as text, never as
 * markup (AWTD-1073). Escape at the point of interpolation. Subjects and
 * plain-text parts are not HTML and must not go through this.
 */
export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
