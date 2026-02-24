/**
 * Maps Astrid taskId ↔ OpenClaw sessionKey.
 * Session key format: `astrid:task:{taskId}`
 */
export class SessionMapper {
  private taskToSession = new Map<string, string>()
  private sessionToTask = new Map<string, string>()

  getOrCreate(taskId: string): string {
    let key = this.taskToSession.get(taskId)
    if (!key) {
      key = `astrid:task:${taskId}`
      this.taskToSession.set(taskId, key)
      this.sessionToTask.set(key, taskId)
    }
    return key
  }

  get(taskId: string): string | undefined {
    return this.taskToSession.get(taskId)
  }

  getTaskId(sessionKey: string): string | undefined {
    return this.sessionToTask.get(sessionKey)
  }

  end(taskId: string): void {
    const key = this.taskToSession.get(taskId)
    if (key) this.sessionToTask.delete(key)
    this.taskToSession.delete(taskId)
  }

  activeCount(): number {
    return this.taskToSession.size
  }
}
