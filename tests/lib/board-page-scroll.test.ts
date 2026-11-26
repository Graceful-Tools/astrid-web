import { describe, it, expect } from "vitest"
import { boardPageTarget } from "@/lib/board-page-scroll"

// ADEV-287: horizontal wheel/trackpad scroll on the web board slides one page of
// columns and snaps, instead of scrolling gradually.
describe("boardPageTarget (ADEV-287)", () => {
  const cols = [0, 300, 600, 900, 1200, 1500]
  it("pages forward by the columns that fit", () => {
    expect(boardPageTarget({ columnLefts: cols, scrollLeft: 0, clientWidth: 650, direction: 1, maxScroll: 900 })).toBe(600)
  })
  it("pages back by the columns that fit", () => {
    expect(boardPageTarget({ columnLefts: cols, scrollLeft: 900, clientWidth: 650, direction: -1, maxScroll: 900 })).toBe(300)
  })
  it("clamps to the scroll range", () => {
    expect(boardPageTarget({ columnLefts: cols, scrollLeft: 600, clientWidth: 650, direction: 1, maxScroll: 900 })).toBe(900)
    expect(boardPageTarget({ columnLefts: cols, scrollLeft: 0, clientWidth: 650, direction: -1, maxScroll: 900 })).toBe(0)
  })
})
