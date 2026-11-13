#!/usr/bin/env bun
// Stdio entry point for the MCP-native Jujutsu plugin (manifest v2 `mcpServer`).
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { loadConfig } from "./config.ts";
import { createJjRunner } from "./runner.ts";
import { createJujutsuMcpServer } from "./server.ts";

const config = loadConfig();
const server = createJujutsuMcpServer({ config, run: createJjRunner({ bin: config.jjBin }) });
await server.connect(new StdioServerTransport());
