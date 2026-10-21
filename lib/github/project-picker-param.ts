/**
 * The query that reopens "Connect a GitHub project" after the user went to
 * GitHub to authorize the App (AWTD-1302). The picker builds the return URL
 * with it; the page that hosts the picker consumes it on load.
 */

export const CONNECT_GITHUB_PROJECT_PARAM = 'connectGithubProject'

/** True once if the current URL asks for the picker; removes the parameter so a reload does not repeat it. */
export function consumeConnectGithubProjectParam(): boolean {
  if (typeof window === 'undefined') return false
  const url = new URL(window.location.href)
  if (url.searchParams.get(CONNECT_GITHUB_PROJECT_PARAM) !== '1') return false
  url.searchParams.delete(CONNECT_GITHUB_PROJECT_PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  return true
}
