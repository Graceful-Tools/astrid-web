import type {
  ChannelAccountSnapshot,
  ChannelPlugin,
  OpenClawConfig,
  ReplyPayload,
} from "openclaw/plugin-sdk";
import { createReplyPrefixOptions } from "openclaw/plugin-sdk";
import { AstridChannel as SDKChannel, ChannelRestClient, ChannelOAuthClient } from "@gracefultools/astrid-sdk";
import type { InboundMessage } from "@gracefultools/astrid-sdk";
import { listAstridAccountIds, resolveAstridAccount } from "./accounts.js";
import { getAstridRuntime } from "./runtime.js";
import type { ResolvedAstridAccount } from "./types.js";

const ASTRID_CHANNEL_ID = "astrid" as const;

/** Active SDK adapters keyed by accountId */
const activeAdapters = new Map<
  string,
  ReturnType<typeof SDKChannel.createAdapter>
>();

export const astridPlugin: ChannelPlugin<ResolvedAstridAccount> = {
  id: ASTRID_CHANNEL_ID,
  meta: {
    id: ASTRID_CHANNEL_ID,
    label: "Astrid",
    selectionLabel: "Astrid.cc",
    docsPath: "/channels/astrid",
    docsLabel: "astrid",
    blurb: "Task management on Astrid.cc",
    order: 200,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
  },
  reload: { configPrefixes: ["channels.astrid"] },
  config: {
    listAccountIds: (cfg) => listAstridAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveAstridAccount(cfg, accountId ?? undefined),
    defaultAccountId: () => "default",
    isConfigured: (account) => account.configured,
    isEnabled: (account) => account.enabled,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const useDefault = !accountId || accountId === "default";
      if (useDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            astrid: {
              ...(cfg.channels?.astrid as Record<string, unknown>),
              enabled,
            },
          },
        } as OpenClawConfig;
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          astrid: {
            ...(cfg.channels?.astrid as Record<string, unknown>),
            accounts: {
              ...cfg.channels?.astrid?.accounts,
              [accountId]: {
                ...cfg.channels?.astrid?.accounts?.[accountId],
                enabled,
              },
            },
          },
        },
      } as OpenClawConfig;
    },
    deleteAccount: ({ cfg, accountId }) => {
      const useDefault = !accountId || accountId === "default";
      if (useDefault) {
        const { clientId, clientSecret, apiBase, agentEmail, ...rest } =
          (cfg.channels?.astrid ?? {}) as Record<string, unknown>;
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            astrid: rest,
          },
        } as OpenClawConfig;
      }
      const { [accountId]: _removed, ...remainingAccounts } = (cfg.channels?.astrid?.accounts ??
        {}) as Record<string, unknown>;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          astrid: {
            ...(cfg.channels?.astrid as Record<string, unknown>),
            accounts: remainingAccounts,
          },
        },
      } as OpenClawConfig;
    },
  },
  security: {
    resolveDmPolicy: () => ({
      policy: "open",
      allowFromPath: "channels.astrid.allowFrom",
      approveHint: "Astrid handles auth via OAuth",
    }),
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async ({ to, text, accountId }) => {
      const id = accountId ?? "default";
      const adapter = activeAdapters.get(id);
      if (!adapter) {
        throw new Error(`Astrid adapter not active for account ${id}`);
      }
      await adapter.send({ content: text, sessionKey: to });
      return { channel: "astrid", messageId: `astrid-${Date.now()}` };
    },
  },
  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    probeAccount: async ({ account }) => {
      if (!account.configured) {
        return { ok: false, error: "Not configured" };
      }
      try {
        const oauth = new ChannelOAuthClient({
          enabled: true,
          clientId: account.config.clientId,
          clientSecret: account.config.clientSecret,
          apiBase: account.config.apiBase || "https://www.astrid.cc/api/v1",
        });
        const rest = new ChannelRestClient(account.config.apiBase, oauth);
        await rest.getAssignedTasks();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: (error as { message?: string })?.message ?? String(error),
        };
      }
    },
    collectStatusIssues: (accounts) => {
      return accounts.flatMap((account) => {
        if (!account.configured) {
          return [
            {
              channel: ASTRID_CHANNEL_ID,
              accountId: account.accountId,
              kind: "config" as const,
              message: "Account not configured (missing clientId or clientSecret)",
            },
          ];
        }
        return [];
      });
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
    }),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const config = account.config;
      const accountId = ctx.accountId;

      ctx.setStatus({
        accountId,
        enabled: account.enabled,
        configured: account.configured,
      } as ChannelAccountSnapshot);

      ctx.log?.info(`[${accountId}] starting Astrid channel`);

      const adapter = SDKChannel.createAdapter({
        enabled: true,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        apiBase: config.apiBase || "https://www.astrid.cc/api/v1",
      });

      activeAdapters.set(accountId, adapter);

      await adapter.init();

      const core = getAstridRuntime();

      const onMessage = async (msg: InboundMessage) => {
        const cfg = await core.config.loadConfig();
        const taskId = (msg.metadata?.taskId as string) ?? msg.sessionKey.replace(/^astrid:task:/, "");

        const route = core.channel.routing.resolveAgentRoute({
          cfg,
          channel: "astrid",
          accountId: accountId,
          peer: { kind: "direct", id: taskId },
        });

        const body = core.channel.reply.formatAgentEnvelope({
          channel: "Astrid",
          from: taskId,
          timestamp: Date.now(),
          body: msg.content,
        });

        const ctxPayload = core.channel.reply.finalizeInboundContext({
          Body: body,
          BodyForAgent: msg.content,
          RawBody: msg.content,
          CommandBody: msg.content,
          From: `astrid:${taskId}`,
          To: `astrid:${config.agentEmail ?? "agent"}`,
          SessionKey: route.sessionKey,
          AccountId: route.accountId,
          ChatType: "direct",
          ConversationLabel: `Task ${taskId}`,
          SenderName: taskId,
          SenderId: taskId,
          Provider: "astrid",
          Surface: "astrid",
          MessageSid: `astrid-${taskId}-${Date.now()}`,
          OriginatingChannel: "astrid",
          OriginatingTo: `astrid:${config.agentEmail ?? "agent"}`,
        });

        const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
          cfg,
          agentId: route.agentId,
          channel: "astrid",
          accountId: route.accountId,
        });
        const humanDelay = core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId);

        await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
          ctx: ctxPayload,
          cfg,
          dispatcherOptions: {
            ...prefixOptions,
            humanDelay,
            deliver: async (payload: ReplyPayload) => {
              const replyText = payload.text;
              if (!replyText) {
                return;
              }
              await adapter.send({
                content: replyText,
                sessionKey: msg.sessionKey,
              });
            },
            onError: (err) => {
              ctx.log?.error(
                `[astrid] reply failed for task ${taskId}: ${String(err)}`,
              );
            },
          },
          replyOptions: {
            onModelSelected,
          },
        });
      };

      await adapter.connect((msg: InboundMessage) => {
        onMessage(msg).catch((error) => {
          ctx.log?.error(
            `[astrid] Failed to handle inbound message: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      });

      const health = adapter.getHealth();
      ctx.log?.info(
        `[astrid] Astrid channel connected (${health.activeSessions} sessions)`,
      );

      ctx.setStatus({
        accountId,
        enabled: account.enabled,
        configured: account.configured,
        running: true,
        connected: true,
        lastStartAt: Date.now(),
      } as ChannelAccountSnapshot);

      // Wire abort signal for graceful shutdown
      if (ctx.abortSignal) {
        ctx.abortSignal.addEventListener(
          "abort",
          () => {
            adapter.disconnect().catch(() => {});
            activeAdapters.delete(accountId);
            ctx.log?.info(`[astrid] Astrid channel disconnected (account ${accountId})`);
          },
          { once: true },
        );
      }
    },
  },
};
