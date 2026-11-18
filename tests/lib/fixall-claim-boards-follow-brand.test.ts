import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The /fixall claim allowlist falls back to Astrid's own boards. A partner deployment
 * inherited them, so every claim on the partner's own board 409'd exactly like a lost race
 * (ADEV-103). The fallback is Astrid's only while the deployment presents Astrid's identity.
 */
async function loadBoards(env: Record<string, string>): Promise<readonly string[]> {
  vi.resetModules()
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  const { FIXALL_CLAIM_BOARD_IDS } = await import("@/lib/fixall-claim")
  return FIXALL_CLAIM_BOARD_IDS
}

describe("FIXALL_CLAIM_BOARD_IDS follows the brand (ADEV-103)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("ADEV-103: a partner deployment does not inherit Astrid's boards", async () => {
    const boards = await loadBoards({
      FIXALL_CLAIM_BOARD_IDS: "",
      NEXT_PUBLIC_BRAND_NAME: "Acme",
      NEXT_PUBLIC_BRAND_DOMAIN: "acme.example",
    })
    expect(boards).toEqual([])
  })

  it("ADEV-103: a partner's own FIXALL_CLAIM_BOARD_IDS is honoured", async () => {
    const boards = await loadBoards({
      FIXALL_CLAIM_BOARD_IDS: "board-1, board-2",
      NEXT_PUBLIC_BRAND_NAME: "Acme",
      NEXT_PUBLIC_BRAND_DOMAIN: "acme.example",
    })
    expect(boards).toEqual(["board-1", "board-2"])
  })

  // Not a count: Astrid's board list grows (ADEV-113 added a fifth while ADEV-103
  // was in review, and the two merges together turned main red).
  it("ADEV-103: Astrid with nothing configured keeps its own boards", async () => {
    const boards = await loadBoards({
      FIXALL_CLAIM_BOARD_IDS: "",
      NEXT_PUBLIC_BRAND_NAME: "",
      NEXT_PUBLIC_BRAND_DOMAIN: "",
    })
    expect(boards.length).toBeGreaterThan(0)
    expect(boards).toContain("a623f322-4c3c-49b5-8a94-d2d9f00c82ba")
    expect(boards).toContain("aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36")
  })
})
