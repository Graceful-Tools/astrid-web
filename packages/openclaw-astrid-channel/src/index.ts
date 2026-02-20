/**
 * @gracefultools/openclaw-astrid-channel
 *
 * OpenClaw channel plugin for Astrid.cc task management
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { astridPlugin } from "./plugin.js";
import { setAstridRuntime } from "./runtime.js";

const plugin = {
  id: "astrid",
  name: "Astrid.cc",
  description: "Task management channel for Astrid.cc",
  register(api: OpenClawPluginApi) {
    setAstridRuntime(api.runtime);
    api.registerChannel({ plugin: astridPlugin });
  },
};

export default plugin;

// Backward-compatible re-exports
export { AstridChannelPlugin } from "./channel.js";
export { astridPlugin } from "./plugin.js";
export type { ResolvedAstridAccount, AstridChannelConfig } from "./types.js";
