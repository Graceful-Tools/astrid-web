/**
 * The Ready/Waiting sweep's writes, kept small and loud.
 *
 * Every mutation is a single-field `statusRole` PUT (never `listIds` — a
 * full-membership PUT is the strand-a-task bug `scripts/set-task-status.ts`
 * exists to prevent) plus one explanatory comment. `--dry-run` prints what would
 * move and writes nothing.
 *
 * Extracted from scripts/ready-tasks.ts for AWTD-970: that script calls `main()`
 * at import, so nothing inside it could be asserted without firing a network
 * request — which is how a comment writer that signed every sweep notice as the
 * OAuth client's owner went unnoticed. Same reason lib/ready-queue-scope.ts
 * exists.
 */

/** Author id for the comments this sweep writes; see scripts/lib/agent-author.ts. */
export type SweepAuthorId = string | null

export class SweepApi {
  constructor(
    private readonly auth: Record<string, string>,
    private readonly dryRun: boolean,
    private readonly report: (...args: unknown[]) => void,
    /**
     * Who signs the sweep's comments. Null means "sign as the authenticated
     * caller" — the field is then OMITTED rather than sent as null, because the
     * API rejects an id it cannot resolve and a sweep that 400s instead of
     * commenting is worse than one wrong byline.
     */
    private readonly authorId: SweepAuthorId = null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiBase: string = 'https://astrid.cc',
  ) {}

  async setStatus(task: { id: string }, statusRole: string): Promise<void> {
    if (this.dryRun) return
    const response = await this.fetchImpl(`${this.apiBase}/api/v1/tasks/${task.id}`, {
      method: "PUT",
      headers: { ...this.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ statusRole }),
    })
    if (!response.ok) {
      this.report(`  ⚠️ could not set ${task.id} → ${statusRole}: HTTP ${response.status}`)
    }
  }

  async comment(task: { id: string }, content: string): Promise<void> {
    if (this.dryRun) return
    const response = await this.fetchImpl(`${this.apiBase}/api/v1/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { ...this.auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        ...(this.authorId ? { aiAgentId: this.authorId } : {}),
      }),
    })
    if (!response.ok) {
      this.report(`  ⚠️ could not comment on ${task.id}: HTTP ${response.status}`)
    }
  }

  async comments(task: { id: string }): Promise<Array<{
    content?: string | null
    createdAt?: string | null
    updatedAt?: string | null
  }>> {
    const response = await this.fetchImpl(`${this.apiBase}/api/v1/tasks/${task.id}/comments`, { headers: this.auth })
    if (!response.ok) return []
    const body = await response.json()
    return Array.isArray(body.comments) ? body.comments : []
  }

  /** Which of these blocker ids are still open? Unfetchable ids count as OPEN — promoting on a guess redoes the strand. */
  async openBlockers(ids: string[]): Promise<string[]> {
    const open: string[] = []
    for (const id of ids) {
      const response = await this.fetchImpl(`${this.apiBase}/api/v1/tasks/${id}`, { headers: this.auth })
      if (!response.ok) {
        open.push(`${id} (unreadable: HTTP ${response.status})`)
        continue
      }
      const body = await response.json()
      if (!body?.task?.completed) open.push(id)
    }
    return open
  }
}
