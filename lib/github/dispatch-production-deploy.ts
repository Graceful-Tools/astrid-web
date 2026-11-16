/**
 * Dispatch `production-deployment.yml` through the GitHub App (AWTD-1694): what an approved
 * deploy runs. Needs the App's `actions: write` permission on the repository.
 *
 * The run is pinned to one commit with `expected_sha`; the workflow refuses if main has moved, so
 * an approval for an older commit can never ship a newer one. `allow_destructive_migrations` is
 * always `false`: a destructive migration keeps its two-deploy rule, and the workflow's own check
 * still refuses it.
 */
import { getGitHubApp, githubAppConfigured } from '@/lib/github/app'

export const PRODUCTION_WORKFLOW = 'production-deployment.yml'
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export type DeployDispatch =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'main_moved' | 'github_error'; message: string }

export async function dispatchProductionDeploy(repository: string, sha: string): Promise<DeployDispatch> {
  if (!REPOSITORY_PATTERN.test(repository)) {
    return { ok: false, reason: 'github_error', message: `\`${repository}\` is not a GitHub repository` }
  }
  if (!githubAppConfigured()) {
    return { ok: false, reason: 'not_configured', message: 'The GitHub App is not configured on this server' }
  }
  const [owner, repo] = repository.split('/')
  try {
    const app = getGitHubApp()
    const { data: installation } = await app.octokit.request('GET /repos/{owner}/{repo}/installation', { owner, repo })
    const octokit = await app.getInstallationOctokit(installation.id)
    const { data: main } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', { owner, repo, ref: 'main' })
    if (main.sha !== sha) {
      return { ok: false, reason: 'main_moved', message: `main is now ${main.sha.slice(0, 8)}, not ${sha.slice(0, 8)}` }
    }
    await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
      owner,
      repo,
      workflow_id: PRODUCTION_WORKFLOW,
      ref: 'main',
      inputs: { skip_tests: 'false', allow_destructive_migrations: 'false', expected_sha: sha },
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: 'github_error', message: err instanceof Error ? err.message : String(err) }
  }
}
