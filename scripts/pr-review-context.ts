#!/usr/bin/env tsx
/**
 * ADEV-325: everything a fixall session reads before landing a held PR, in one call.
 * A scheduled `claude -p` session cannot run `gh`, but it can run npm scripts.
 *
 *   npm run fixall:pr-review -- <number> [--repo Graceful-Tools/astrid-core]
 *
 * Prints the PR's state, checks, changed files, reviews, inline review comments
 * (Copilot's land here, not in `gh pr checks`), conversation comments, then the diff.
 */
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const number = args.find((arg) => /^\d+$/.test(arg))
const repoIndex = args.indexOf('--repo')
const repo = repoIndex === -1 ? 'Graceful-Tools/astrid-web' : args[repoIndex + 1]
if (!number || !repo) {
  console.error('usage: npm run fixall:pr-review -- <number> [--repo owner/name]')
  process.exit(2)
}

const gh = (...a: string[]) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const section = (title: string, body: string) => console.log(`\n=== ${title} ===\n${body.trim() || '(none)'}`)

const view = JSON.parse(
  gh('pr', 'view', number, '--repo', repo, '--json', 'title,headRefName,headRefOid,state,isDraft,mergeable,mergeStateStatus,files'),
) as { title: string; headRefName: string; headRefOid: string; state: string; isDraft: boolean; mergeable: string; mergeStateStatus: string; files: Array<{ path: string; additions: number; deletions: number }> }

section(`#${number} ${view.title}`, [
  `branch ${view.headRefName} @ ${view.headRefOid}`,
  `state ${view.state}${view.isDraft ? ' (draft)' : ''}, ${view.mergeable}/${view.mergeStateStatus}`,
].join('\n'))

let checks = ''
try {
  checks = gh('pr', 'checks', number, '--repo', repo)
} catch (error) {
  // `gh pr checks` exits non-zero when a check is red or pending; its output is still the answer.
  checks = String((error as { stdout?: string }).stdout ?? '')
}
section('checks', checks)
section('files', view.files.map((f) => `${f.path} (+${f.additions} -${f.deletions})`).join('\n'))
section('reviews', gh('api', `repos/${repo}/pulls/${number}/reviews`, '--jq', '.[] | "\\(.user.login) \\(.state): \\(.body)"'))
section('inline review comments', gh('api', `repos/${repo}/pulls/${number}/comments`, '--jq', '.[] | "\\(.user.login) \\(.path):\\(.line // .original_line): \\(.body)"'))
section('conversation', gh('api', `repos/${repo}/issues/${number}/comments`, '--jq', '.[] | "\\(.user.login): \\(.body)"'))
section('diff', gh('pr', 'diff', number, '--repo', repo))
