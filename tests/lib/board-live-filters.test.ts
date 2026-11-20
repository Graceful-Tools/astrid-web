import { describe, it, expect } from "vitest"
import { applyBoardLiveFilters } from "@/lib/board-live-filters"
import type { Task } from "@/types/task"

const task = (id: string, extra: Partial<Task> = {}) =>
  ({ id, title: id, priority: 0, completed: false, assigneeId: null, dueDateTime: null, ...extra }) as unknown as Task

const none = { priority: [], assignee: [], dueDate: "all" as const }

describe("applyBoardLiveFilters (ADEV-145)", () => {
  const tasks = [task("a", { priority: 3 }), task("b", { priority: 1 }), task("c", { priority: 3, assigneeId: "u1" })]

  it("passes everything through with no filters", () => {
    expect(applyBoardLiveFilters(tasks, none)).toHaveLength(3)
    expect(applyBoardLiveFilters(tasks, undefined)).toHaveLength(3)
  })

  it("narrows by priority", () => {
    const ids = applyBoardLiveFilters(tasks, { ...none, priority: [3] }).map(t => t.id)
    expect(ids).toEqual(["a", "c"])
  })

  it("narrows by assignee and combines with priority", () => {
    const ids = applyBoardLiveFilters(tasks, { ...none, priority: [3], assignee: ["u1"] }).map(t => t.id)
    expect(ids).toEqual(["c"])
  })

  it("overdue excludes undated and completed tasks", () => {
    const past = new Date(Date.now() - 3 * 86400000).toISOString()
    const set = [task("late", { dueDateTime: past as any }), task("done", { dueDateTime: past as any, completed: true }), task("none")]
    expect(applyBoardLiveFilters(set, { ...none, dueDate: "overdue" }).map(t => t.id)).toEqual(["late"])
  })
})
