/**
 * @gracefultools/openclaw-astrid-channel
 *
 * OpenClaw channel plugin for Astrid.cc task management
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { AstridChannelPlugin } from "./channel.js";
import { astridPlugin } from "./plugin.js";
import { setAstridRuntime } from "./runtime.js";

const plugin = {
  id: "astrid" as const,
  name: "Astrid.cc",
  description: "Task management channel for Astrid.cc",
  register(api: OpenClawPluginApi) {
    setAstridRuntime(api.runtime);
    api.registerChannel({ plugin: astridPlugin });
  },
  AstridChannelPlugin,
  astridPlugin,
};

export = plugin;
