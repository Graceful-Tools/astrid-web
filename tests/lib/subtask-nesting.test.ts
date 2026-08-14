/**
 * Indent and outdent — changing how deeply a task is nested, without dragging it.
 *
 * The iOS/Mac port of these rules already exists as `DragNesting` in astrid-ios
 * (Astrid App/Core/Filters/DragNesting.swift) and is tested there against the same
 * cases. Web is the canonical side of the keyboard contract, so these two must agree:
 * if they drift, the same keystroke does different things on different platforms.
 */

import { describe, it, expect } from "vitest"
import { indentTask, outdentTask, INDENT_KEY, OUTDENT_KEY } from "@/lib/subtask-nesting"

/** parent → child → grandchild, plus a second top-level task. */
const TREE = [
  { id: "p", parentTaskId: null },
  { id: "c", parentTaskId: "p" },
  { id: "g", parentTaskId: "c" },
  { id: "o", parentTaskId: null },
]

const byId = (id: string) => TREE.find((t) => t.id === id)!

describe("outdentTask", () => {
  it("moves a direct subtask to top level", () => {
    expect(outdentTask(byId("c"), TREE)).toEqual({ taskId: "c", parentTaskId: null })
  })

  it("moves a deeper task under its grandparent, one level at a time", () => {
    // Not straight to the top: jumping several levels from one keystroke is a surprise
    // that is awkward to undo.
    expect(outdentTask(byId("g"), TREE)).toEqual({ taskId: "g", parentTaskId: "p" })
  })

  it("does nothing for a task that is already top level", () => {
    expect(outdentTask(byId("o"), TREE)).toBeNull()
  })

  it("treats an empty parent id as no parent", () => {
    expect(outdentTask({ id: "x", parentTaskId: "" }, TREE)).toBeNull()
  })

  it("does nothing for a task that is not there", () => {
    expect(outdentTask(null, TREE)).toBeNull()
    expect(outdentTask(undefined, TREE)).toBeNull()
  })
})

describe("indentTask", () => {
  it("nests a task under its previous sibling", () => {
    // `o` is top level and `p` is the nearest earlier task sharing that parent.
    expect(indentTask(byId("o"), TREE)).toEqual({ taskId: "o", parentTaskId: "p" })
  })

  it("does nothing for a first child, which has no previous sibling", () => {
    expect(indentTask(byId("c"), TREE)).toBeNull()
  })

  it("does nothing for the very first row", () => {
    expect(indentTask(byId("p"), TREE)).toBeNull()
  })

  it("never nests a task under its own descendant", () => {
    // A cycle costs you BOTH tasks: the subtask walk never reaches them again, so they
    // vanish from the list with no way back through the UI. Reaching this needs data that
    // already loops, which is exactly when a defensive guard earns its keep: `s` is a
    // sibling of `t` by parent, but `p`'s own parent is `t`, so `s` descends from `t`.
    const rows = [
      { id: "s", parentTaskId: "p" },
      { id: "t", parentTaskId: "p" },
      { id: "p", parentTaskId: "t" },
    ]
    expect(indentTask(rows[1], rows)).toBeNull()
  })
})

describe("indent and outdent are inverses", () => {
  it("returns a task to its original parent", () => {
    const indented = indentTask(byId("o"), TREE)!
    const moved = { id: "o", parentTaskId: indented.parentTaskId }
    const rows = TREE.map((t) => (t.id === "o" ? moved : t))
    expect(outdentTask(moved, rows)).toEqual({ taskId: "o", parentTaskId: null })
  })
})

describe("the keys themselves", () => {
  it("uses the bracket convention, and does not collide with the arrows", () => {
    // ← and → are already due-date-earlier/later.
    expect(OUTDENT_KEY).toBe("[")
    expect(INDENT_KEY).toBe("]")
  })
})
