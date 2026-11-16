import { describe, expect, it } from "vitest";
import { loadCreateReplyPrefixOptions } from "../../packages/openclaw-astrid-channel/src/openclaw-sdk-compat";

// Current OpenClaw (2026.11) exports only subpaths such as
// `openclaw/plugin-sdk/channel-outbound`; the bare `openclaw/plugin-sdk`
// import that 2.1.0 used fails with ERR_PACKAGE_PATH_NOT_EXPORTED, so the
// plugin could not load on a current host. Older hosts only have the bare path.
describe("loadCreateReplyPrefixOptions", () => {
  const fromSubpath = () => ({ from: "subpath" });
  const fromBare = () => ({ from: "bare" });

  it("prefers the channel-outbound subpath that current OpenClaw exports", () => {
    const req = (id: string) => {
      if (id === "openclaw/plugin-sdk/channel-outbound") return { createReplyPrefixOptions: fromSubpath };
      if (id === "openclaw/plugin-sdk") return { createReplyPrefixOptions: fromBare };
      throw new Error(`unexpected ${id}`);
    };
    expect(loadCreateReplyPrefixOptions(req)).toBe(fromSubpath);
  });

  it("falls back to the bare import on older hosts without subpaths", () => {
    const req = (id: string) => {
      if (id === "openclaw/plugin-sdk") return { createReplyPrefixOptions: fromBare };
      const err = Object.assign(new Error(`Cannot find module '${id}'`), { code: "MODULE_NOT_FOUND" });
      throw err;
    };
    expect(loadCreateReplyPrefixOptions(req)).toBe(fromBare);
  });

  it("names both paths when neither provides the function", () => {
    const req = () => ({});
    expect(() => loadCreateReplyPrefixOptions(req)).toThrow(/channel-outbound.*plugin-sdk/s);
  });
});
