import type { AgentQueueResult } from '@/lib/agent-queue'
import { FIXALL_CLAIM_BOARD_IDS, nativeCopilotClaimMarker } from '@/lib/fixall-claim'
import { createHash } from 'node:crypto'

export interface BridgeTransport {
  astrid<T>(path: string, body?: unknown): Promise<T>
  github<T>(path: string, body?: unknown): Promise<T>
}

interface TaskComment {
  id: string
  content: string
  updatedAt: string
  authorId: string | null
  author: { isAIAgent: boolean } | null
  systemEventType?: string | null
}

interface BridgeTask {
  id: string
  title: string
  identifier?: string | null
  description?: string | null
  completed: boolean
  assigneeId: string | null
  statusRole: string | null
  updatedAt: string
  lists: Array<{ id: string }>
}

interface GithubComment {
  id: number
  body: string | null
  html_url: string
  updated_at: string
  user: { login: string } | null
}

interface GithubIssue {
  number: number
  body: string | null
  html_url: string
  state: string
  updated_at: string
  user: { login: string } | null
  assignees: Array<{ login: string }>
  pull_request?: unknown
}

interface GithubPull {
  number: number
  body: string | null
  html_url: string
  state: string
  user: { login: string } | null
  head: { sha: string }
  base: { repo: { full_name: string } }
}

const isCopilot = (login?: string) => ['copilot-swe-agent[bot]', 'copilot-swe-agent', 'Copilot'].includes(login || '')
const sourceMarker = (list: string, task: string) => `<!-- astrid-native:v1:${list}:${task} -->`
const replyMarker = (comment: TaskComment) => `<!-- astrid-reply:${comment.id}:${comment.updatedAt} -->`

/** Bounded pagination must fail, not truncate the history used for idempotency. */
async function pages<T>(api: BridgeTransport['github'], path: string): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; page <= 20; page++) {
    const batch = await api<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    if (!Array.isArray(batch)) throw new Error(`Expected a GitHub page at ${path}`)
    rows.push(...batch)
    if (batch.length < 100) return rows
  }
  throw new Error(`GitHub history exceeds the 2000-row safety bound: ${path}`)
}

export async function runNativeCopilotBridge(options: {
  transport: BridgeTransport
  repo: string
  listId: string
  dryRun: boolean
  issueTemplate: string
  report: (message: string) => void
}): Promise<void> {
  const { transport: api, repo, listId, dryRun, report } = options
  if (!FIXALL_CLAIM_BOARD_IDS.includes(listId)) throw new Error('Native bridge requires an allowed explicit board ID')
  const queue = await api.astrid<AgentQueueResult>(`/api/v1/agent-queue?agent=copilot&listId=${encodeURIComponent(listId)}`)
  if (queue.mode !== 'polling') throw new Error(`Copilot must be polling-only; current mode: ${queue.mode}`)
  const agentId = queue.agent.id
  if (!agentId || queue.agent.mailbox !== 'copilot') throw new Error('Copilot agent identity is not provisioned or mismatched')
  for (const skipped of queue.attention.skipped) report(`UNREAD: ${skipped}`)
  if (queue.truncated || queue.attention.truncated) throw new Error('Native bridge queue/inbox is truncated')
  const actor = await api.github<{ login: string }>('/user')
  if (!actor.login || actor.login.endsWith('[bot]')) throw new Error('Native dispatch requires a real user-to-server GitHub token')
  const [owner, name] = repo.split('/')
  if (!owner || !name || repo.split('/').length !== 2) throw new Error('Invalid target repository')
  const availability = await api.github<{
    data?: { repository?: { suggestedActors?: { nodes: Array<{ login: string }> } } }
  }>('/graphql', {
    query: 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){suggestedActors(capabilities:[CAN_BE_ASSIGNED],first:100){nodes{login}}}}',
    variables: { owner, name },
  })
  if (!availability.data?.repository?.suggestedActors?.nodes.some(row => row.login === 'copilot-swe-agent')) {
    throw new Error('GitHub native Copilot is not assignable for this repository and token')
  }

  const issues = await pages<GithubIssue>(api.github, `/repos/${repo}/issues?state=all`)
  const linked = new Map<string, GithubIssue>()
  for (const issue of issues) {
    if (issue.pull_request) continue
    const match = issue.body?.match(/<!-- astrid-native:v1:([a-zA-Z0-9-]+):([a-zA-Z0-9-]+) -->\s*$/)
    if (!match && issue.body?.includes(`<!-- astrid-native:v1:${listId}:`)) {
      throw new Error(`Malformed native task mapping on issue ${issue.number}`)
    }
    if (!match || match[1] !== listId) continue
    if (issue.user?.login !== actor.login) throw new Error(`Native mapping on issue ${issue.number} belongs to another dispatcher`)
    if (linked.has(match[2])) throw new Error(`Duplicate native Copilot issues for task ${match[2]}`)
    linked.set(match[2], issue)
  }
  const candidates = new Set([...linked.keys(), ...queue.queue.map(task => task.id)])
  let newStarts = 0
  for (const taskId of candidates) {
    const { task } = await api.astrid<{ task: BridgeTask }>(`/api/v1/tasks/${taskId}`)
    if (task.completed || !task.lists.some(list => list.id === listId)) continue
    const resume = queue.attention.tasks.find(row => row.id === taskId)?.resume
    const ready = queue.queue.some(row => row.id === taskId)
    if (task.assigneeId !== agentId && !resume) continue
    let issue = linked.get(taskId)
    if (!issue && !ready) continue
    if (!issue?.assignees.some(row => isCopilot(row.login)) && newStarts >= 1) {
      report(`HELD ${taskId}: one new native session per tick`)
      continue
    }
    const commentsBody = await api.astrid<{ comments: TaskComment[]; meta?: { truncated?: boolean } }>(
      `/api/v1/tasks/${taskId}/comments`,
    )
    if (commentsBody.meta?.truncated) throw new Error(`Task ${taskId} comment history is truncated`)
    const comments = commentsBody.comments
    const marker = sourceMarker(listId, taskId)
    const committedClaim = issue && nativeCopilotClaimMarker(listId, taskId, { repository: repo, issueNumber: issue.number })
    if (issue && !ready && !comments.some(row => row.authorId === agentId &&
        row.content === committedClaim)) {
      report(`HELD ${taskId}: inert mirror has no committed native claim; another Copilot session may own it`)
      continue
    }
    report(`${dryRun ? 'WOULD SYNC' : 'SYNC'} ${task.identifier || taskId}${issue ? ` issue ${issue.number}` : ''}`)
    if (dryRun) continue
    const comment = async (content: string) => {
      await api.astrid(`/api/v1/tasks/${taskId}/comments`, { content, aiAgentId: agentId })
    }
    const pauseOwnedDoing = async () => {
      const fresh = await api.astrid<{ task: BridgeTask }>(`/api/v1/tasks/${taskId}`)
      const history = await api.astrid<{ comments: TaskComment[]; meta?: { truncated?: boolean } }>(
        `/api/v1/tasks/${taskId}/comments`,
      )
      if (history.meta?.truncated) throw new Error(`Task ${taskId} comment history is truncated`)
      if (fresh.task.statusRole !== 'doing' || fresh.task.assigneeId !== agentId) return
      const watermark = history.comments.map(row => row.updatedAt)
        .sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)
      await api.astrid(`/api/v1/tasks/${taskId}/claim-fixall`, {
        action: 'pause', agent: 'copilot', listId,
        taskVersion: fresh.task.updatedAt, commentWatermark: watermark,
      })
    }
    // Creating an UNASSIGNED mirror cannot start an agent. Do it before the
    // atomic claim so an uncertain create response cannot strand a Doing task.
    if (!issue) {
      const context = comments.filter(row => !row.systemEventType).map(row =>
        `${row.author?.isAIAgent ? 'Agent' : 'Human'}: ${row.content}\n${replyMarker(row)}`,
      ).join('\n\n')
      issue = await api.github<GithubIssue>(`/repos/${repo}/issues`, {
        title: `[${task.identifier || taskId}] ${task.title}`,
        body: `${options.issueTemplate}\n\n## Astrid source of truth\n${task.description || 'N/A'}\n\n${context}\n\n${marker}`,
      })
    }
    if (issue.state !== 'open') {
      await pauseOwnedDoing()
      const closed = `<!-- native-copilot-closed:${issue.number} -->`
      if (!comments.some(row => row.authorId === agentId && row.content.includes(closed))) {
        await comment(`The native Copilot issue is closed. No new execution was started, and this task remains incomplete pending its existing review/release or recovery.\n${issue.html_url}\n${closed}`)
      }
      report(`HELD ${taskId}: native issue ${issue.number} is closed; no automatic re-dispatch`)
      continue
    }
    if (ready || resume) {
      await api.astrid(`/api/v1/tasks/${taskId}/claim-fixall`, {
        action: resume ? 'resume' : 'ready', agent: 'copilot', listId,
        ...(resume ? { resume, commentWatermark: resume.commentWatermark } : {}),
        ...(!resume ? { nativeDispatch: { repository: repo, issueNumber: issue.number } } : {}),
      })
    } else if (task.statusRole !== 'doing' && task.statusRole !== 'waiting') {
      continue
    }
    if (!issue.assignees.some(row => isCopilot(row.login))) {
      const attempts = await pages<GithubComment>(api.github, `/repos/${repo}/issues/${issue.number}/comments`)
      const attemptMarker = '<!-- astrid-native-dispatch-attempt:v1 -->'
      const count = attempts.filter(row => row.user?.login === actor.login && row.body?.includes(attemptMarker)).length
      if (count >= 3) {
        await pauseOwnedDoing()
        const exhausted = `<!-- native-dispatch-exhausted:${issue.number} -->`
        if (!comments.some(row => row.authorId === agentId && row.content.includes(exhausted))) {
          await comment(`Native Copilot could not start after three attempts. Human setup/recovery is required; this task is not finished.\n${issue.html_url}\n${exhausted}`)
        }
        throw new Error(`Native Copilot dispatch for ${taskId} exhausted three persisted attempts; inspect issue ${issue.html_url}`)
      }
      await api.github(`/repos/${repo}/issues/${issue.number}/comments`, { body: `${attemptMarker}\nNative dispatch attempt ${count + 1}.` })
      try {
        const assigned = await api.github<GithubIssue>(`/repos/${repo}/issues/${issue.number}/assignees`, {
          assignees: ['copilot-swe-agent[bot]'],
          agent_assignment: {
            target_repo: repo, base_branch: 'main',
            custom_instructions: `Astrid task ${taskId} on board ${listId} is already claimed by this session. Read ASTRID.md and docs/FIXALL_WORKFLOW.md. Work only this task, do not claim other queue work. Use Astrid MCP to read/reply as copilot; if unavailable report the blocker. Keep questions and updates in Astrid. Include ${marker} and Fixes #${issue.number} in the PR body. No merging, deployment, production access or restricted releases. Stop at a tested PR; pending migrations and privileged releases need explicit human approval. A human conversation is not that approval.`,
          },
        })
        if (!assigned.assignees.some(row => isCopilot(row.login))) throw new Error(`GitHub did not assign native Copilot to ${issue.html_url}`)
        issue = assigned
        newStarts++
      } catch (error) {
        await comment(`Native Copilot dispatch attempt ${count + 1} could not be confirmed: ${error instanceof Error ? error.message : String(error)}. The next tick revalidates the existing assignment before retrying; no fallback agent was started.`)
        throw error
      }
      const notice = `<!-- astrid-native-issue:${issue.number} -->`
      if (!comments.some(row => row.authorId === agentId && row.content.includes(notice))) {
        await comment(`GitHub native Copilot accepted ${issue.html_url}. Continue replying on this Astrid task.\n${notice}`)
      }
    }
    const timeline = await pages<{ event: string; source?: { issue?: { number?: number; pull_request?: unknown } } }>(
      api.github, `/repos/${repo}/issues/${issue.number}/timeline`,
    )
    const pulls: GithubPull[] = []
    for (const event of timeline) {
      const reference = event.source?.issue
      if (event.event !== 'cross-referenced' || !reference?.pull_request || !reference.number) continue
      const pull = await api.github<GithubPull>(`/repos/${repo}/pulls/${reference.number}`)
      if (pull.base.repo.full_name === repo && isCopilot(pull.user?.login) && pull.body?.includes(marker) &&
          !pulls.some(row => row.number === pull.number)) pulls.push(pull)
    }
    if (pulls.filter(pull => pull.state === 'open').length > 1) throw new Error(`Multiple open native PRs for ${taskId}`)
    const pull = pulls.find(row => row.state === 'open')
    const destinations = [issue.number, ...(pull ? [pull.number] : [])]
    for (const number of destinations) {
      const githubComments = await pages<GithubComment>(api.github, `/repos/${repo}/issues/${number}/comments`)
      for (const row of githubComments.filter(row => isCopilot(row.user?.login))) {
        const mirrored = `<!-- github-copilot:${row.id}:${row.updated_at} -->`
        if (!comments.some(existing => existing.authorId === agentId && existing.content.includes(mirrored))) {
          await comment(`GitHub Copilot: ${row.body || '(empty comment)'}\n\n${row.html_url}\n${mirrored}`)
        }
      }
      if (!pull || number !== pull.number) continue
      const replies = comments.filter(row => row.author?.isAIAgent === false && !row.systemEventType).filter(human => {
        const forwarded = replyMarker(human)
        return !issue.body?.includes(forwarded) &&
          !githubComments.some(row => row.user?.login === actor.login && row.body?.includes(forwarded))
      })
      if (replies.length > 0) {
        const current = await api.github<GithubPull>(`/repos/${repo}/pulls/${number}`)
        if (current.state !== 'open' || current.head.sha !== pull.head.sha ||
            current.base.repo.full_name !== repo || !current.body?.includes(marker) ||
            !isCopilot(current.user?.login)) throw new Error(`Native PR ${number} changed before continuation; retry from a fresh snapshot`)
        await api.github(`/repos/${repo}/issues/${number}/comments`, {
          body: `@copilot The user replied on the source Astrid task ${taskId}, PR #${number} at head ${current.head.sha}:\n\n${replies.map(human => `${human.content}\n${replyMarker(human)}`).join('\n\n')}\n\nContinue only this task; conversational replies do not authorize migrations or privileged releases.\n<!-- astrid-continuation:${taskId}:${number}:${current.head.sha} -->`,
        })
      }
    }
    if (pull) {
      const bodyHash = createHash('sha256').update(pull.body || '').digest('hex').slice(0, 16)
      const update = `<!-- github-copilot-pr:${pull.number}:${pull.head.sha}:${bodyHash} -->`
      if (!comments.some(row => row.authorId === agentId && row.content.includes(update))) {
        await comment(`Native Copilot PR: ${pull.html_url}\nHead: ${pull.head.sha}\n\n${pull.body || '(no PR description)'}\n\nNot merged or deployed. Required approvals and quality gates still apply.\n${update}`)
      }
    } else {
      const lastActivity = Date.parse(issue.updated_at)
      if (!Number.isFinite(lastActivity)) throw new Error(`Native issue ${issue.number} has no valid activity timestamp`)
      if (Date.now() - lastActivity > 180 * 60_000) {
        await pauseOwnedDoing()
        const stalled = `<!-- native-copilot-stalled:${issue.number} -->`
        if (!comments.some(row => row.authorId === agentId && row.content.includes(stalled))) {
          await comment(`Native Copilot has no linked open PR and no issue activity for three hours. This task is parked for investigation, not finished. Existing native execution is not cancelled or restarted; replies remain pending until its PR exists.\n${issue.html_url}\n${stalled}`)
        }
        report(`HELD ${taskId}: native execution needs investigation`)
      }
    }
  }
}
