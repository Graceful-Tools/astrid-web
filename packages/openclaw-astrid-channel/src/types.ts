/**
 * OpenClaw Channel Plugin Types for Astrid.cc
 */

export interface AstridChannelConfig {
  enabled?: boolean;
  clientId: string;
  clientSecret: string;
  apiBase?: string;
  agentEmail?: string;
  pollIntervalMs?: number;
  lists?: string[];
}

export interface ResolvedAstridAccount {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  config: AstridChannelConfig;
}
