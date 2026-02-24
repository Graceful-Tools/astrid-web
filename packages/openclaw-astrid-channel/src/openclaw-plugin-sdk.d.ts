/**
 * Type stubs for the `openclaw/plugin-sdk` peer dependency.
 *
 * OpenClaw provides these types at runtime. This file allows the package
 * to compile standalone (without `openclaw` installed) for publishing.
 */

declare module "openclaw/plugin-sdk" {
  /** Top-level OpenClaw configuration object */
  export interface OpenClawConfig {
    channels?: {
      astrid?: {
        enabled?: boolean;
        clientId?: string;
        clientSecret?: string;
        apiBase?: string;
        agentEmail?: string;
        pollIntervalMs?: number;
        lists?: string[];
        accounts?: Record<string, any>;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  /** Plugin registration API */
  export interface OpenClawPluginApi {
    runtime: PluginRuntime;
    registerChannel(opts: { plugin: ChannelPlugin<any> }): void;
  }

  /** Runtime services exposed to plugins */
  export interface PluginRuntime {
    config: {
      loadConfig(): Promise<OpenClawConfig>;
    };
    channel: {
      routing: {
        resolveAgentRoute(opts: any): {
          sessionKey: string;
          accountId: string;
          agentId: string;
        };
      };
      reply: {
        formatAgentEnvelope(opts: any): string;
        finalizeInboundContext(opts: any): any;
        resolveHumanDelayConfig(cfg: any, agentId: string): any;
        dispatchReplyWithBufferedBlockDispatcher(opts: any): Promise<void>;
      };
    };
  }

  /** Channel plugin definition */
  export interface ChannelPlugin<TAccount = any> {
    id: string;
    meta: {
      id: string;
      label: string;
      selectionLabel: string;
      docsPath: string;
      docsLabel: string;
      blurb: string;
      order: number;
    };
    capabilities: {
      chatTypes: string[];
      media: boolean;
    };
    reload?: { configPrefixes: string[] };
    config: {
      listAccountIds: (cfg: OpenClawConfig) => string[];
      resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => TAccount;
      defaultAccountId: () => string;
      isConfigured: (account: TAccount) => boolean;
      isEnabled: (account: TAccount) => boolean;
      describeAccount: (account: TAccount) => any;
      setAccountEnabled: (opts: { cfg: OpenClawConfig; accountId: string; enabled: boolean }) => OpenClawConfig;
      deleteAccount: (opts: { cfg: OpenClawConfig; accountId: string }) => OpenClawConfig;
    };
    security?: {
      resolveDmPolicy: () => any;
    };
    outbound?: {
      deliveryMode: string;
      sendText: (opts: { to: string; text: string; accountId?: string }) => Promise<any>;
    };
    status?: {
      defaultRuntime: any;
      probeAccount: (opts: { account: TAccount }) => Promise<{ ok: boolean; error?: string }>;
      collectStatusIssues: (accounts: TAccount[]) => any[];
      buildAccountSnapshot: (opts: { account: TAccount; runtime: any; probe: any }) => any;
      buildChannelSummary: (opts: { snapshot: any }) => any;
    };
    gateway?: {
      startAccount: (ctx: GatewayContext<TAccount>) => Promise<void>;
    };
  }

  /** Context passed to gateway.startAccount */
  export interface GatewayContext<TAccount = any> {
    account: TAccount & { config: any };
    accountId: string;
    abortSignal?: AbortSignal;
    log?: {
      info: (msg: string) => void;
      error: (msg: string) => void;
      warn: (msg: string) => void;
      debug: (msg: string) => void;
    };
    setStatus: (status: any) => void;
  }

  /** Account snapshot for status reporting */
  export interface ChannelAccountSnapshot {
    accountId: string;
    enabled: boolean;
    configured: boolean;
    running?: boolean;
    connected?: boolean;
    lastStartAt?: number | null;
    lastStopAt?: number | null;
    lastError?: string | null;
    probe?: any;
    [key: string]: unknown;
  }

  /** Payload delivered to outbound handler */
  export interface ReplyPayload {
    text: string;
    [key: string]: unknown;
  }

  /** Create reply prefix options helper */
  export function createReplyPrefixOptions(opts: {
    cfg: OpenClawConfig;
    agentId: string;
    channel: string;
    accountId: string;
  }): { onModelSelected?: any; [key: string]: any };
}
