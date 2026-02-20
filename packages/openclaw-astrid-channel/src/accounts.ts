import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { AstridChannelConfig, ResolvedAstridAccount } from "./types.js";

export function listAstridAccountIds(cfg: OpenClawConfig): string[] {
  const base = cfg.channels?.astrid as
    | { clientId?: string; accounts?: Record<string, unknown> }
    | undefined;
  if (!base) {
    return [];
  }
  const ids: string[] = [];
  if (base.clientId) {
    ids.push("default");
  }
  if (base.accounts) {
    ids.push(...Object.keys(base.accounts));
  }
  return ids;
}

export function resolveAstridAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedAstridAccount {
  const base = cfg.channels?.astrid as
    | (AstridChannelConfig & { accounts?: Record<string, AstridChannelConfig> })
    | undefined;

  if (!base) {
    return {
      accountId: accountId || "default",
      enabled: false,
      configured: false,
      config: { clientId: "", clientSecret: "" },
    };
  }

  const useDefault = !accountId || accountId === "default";
  const account = useDefault ? base : base.accounts?.[accountId];

  const clientId = (account?.clientId ?? base.clientId ?? "") as string;
  const clientSecret = (account?.clientSecret ?? base.clientSecret ?? "") as string;
  const configured = Boolean(clientId && clientSecret);

  return {
    accountId: accountId || "default",
    enabled: (account?.enabled ?? base.enabled ?? true) !== false,
    configured,
    config: {
      enabled: (account?.enabled ?? base.enabled ?? true) !== false,
      clientId,
      clientSecret,
      apiBase: (account?.apiBase ?? base.apiBase) as string | undefined,
      agentEmail: (account?.agentEmail ?? base.agentEmail) as string | undefined,
      pollIntervalMs: (account?.pollIntervalMs ?? base.pollIntervalMs) as number | undefined,
      lists: (account?.lists ?? base.lists) as string[] | undefined,
    },
  };
}
