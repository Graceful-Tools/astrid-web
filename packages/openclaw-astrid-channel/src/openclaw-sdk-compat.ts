// Mirrors the stub in openclaw-plugin-sdk.d.ts. Declared here rather than
// imported so the repo's test-tree typecheck, which does not see that ambient
// module, can compile this file.
type CreateReplyPrefixOptions = (opts: {
  cfg: Record<string, unknown>;
  agentId: string;
  channel: string;
  accountId: string;
}) => { onModelSelected?: unknown; [key: string]: unknown };
type Require = (id: string) => unknown;

/**
 * OpenClaw moved its plugin SDK to subpath exports: current hosts export
 * `openclaw/plugin-sdk/channel-outbound` and refuse the bare
 * `openclaw/plugin-sdk` (ERR_PACKAGE_PATH_NOT_EXPORTED), while older hosts only
 * have the bare path. Try the subpath first, then the bare path.
 */
const CANDIDATES = ["openclaw/plugin-sdk/channel-outbound", "openclaw/plugin-sdk"] as const;

export function loadCreateReplyPrefixOptions(req: Require = require): CreateReplyPrefixOptions {
  for (const id of CANDIDATES) {
    let mod: unknown;
    try {
      mod = req(id);
    } catch {
      continue;
    }
    const fn = (mod as { createReplyPrefixOptions?: unknown } | null)?.createReplyPrefixOptions;
    if (typeof fn === "function") return fn as CreateReplyPrefixOptions;
  }
  throw new Error(`createReplyPrefixOptions not found in ${CANDIDATES.join(" or ")}; is OpenClaw installed?`);
}
