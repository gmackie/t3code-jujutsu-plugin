// Test fixtures: a fake jj CLI (as a CommandRunner) and an in-memory MCP client.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import type { JujutsuConfig } from "./config.ts";
import type { CommandRunner } from "./jj.ts";
import { createJujutsuMcpServer } from "./server.ts";

/** The jj subcommand words in an argv, skipping flags and the values of -T/-n/-r. */
export function subcommand(command: readonly string[]): string {
  const words: string[] = [];
  for (let index = 1; index < command.length && words.length < 2; index++) {
    const arg = command[index]!;
    if (arg === "--") break;
    if (["-T", "-n", "-r"].includes(arg)) index++;
    else if (!arg.startsWith("-")) words.push(arg);
  }
  return words.join(" ");
}

const READS: Record<string, string> = {
  root: "/work/project\n",
  log: "zzyy\tabc123\tDraft <feature>\tmackie@example.com\tfeature\t1\t1\nxxww\tdef456\tBase\tmackie@example.com\tmain\t0\t0\n",
  "op log": "op1\tdescribe commit abc\tmackie@laptop\t2026-11-13T14:50:39-06:00\n",
  "bookmark list": "feature\t\t0\tzzyy\nmain\t\t0\txxww\nmain\torigin\t0\txxww\n",
  "workspace list": "default\tzzyy\nreview\txxww\n",
  resolve: "src/a.ts    2-sided conflict\n",
};
const WORKING_COPY = "zzyy\tDraft <feature>\t0\t1\n";

export function fakeJj(overrides: { fail?: (command: readonly string[]) => Error | undefined } = {}) {
  const commands: string[][] = [];
  const cwds: (string | undefined)[] = [];
  const mutations: string[][] = [];
  const run: CommandRunner = async (command, options) => {
    commands.push([...command]);
    cwds.push(options?.cwd);
    const failure = overrides.fail?.(command);
    if (failure) throw failure;
    const name = subcommand(command);
    if (name === "log" && command.includes("-r")) return WORKING_COPY;
    const read = READS[name] ?? READS[name.split(" ")[0]!];
    if (read !== undefined) return read;
    mutations.push(command.slice(1).filter((arg) => !arg.startsWith("--repository=") && arg !== "--no-pager" && arg !== "--color=never"));
    return "";
  };
  return { run, commands, cwds, mutations };
}

export async function connectedClient(options: { config?: Partial<JujutsuConfig>; run?: CommandRunner } = {}) {
  const jj = fakeJj();
  const server = createJujutsuMcpServer({
    config: { jjBin: "jj", pollSeconds: 30, mutationsEnabled: false, ...options.config },
    run: options.run ?? jj.run,
    cwd: "/work/project",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server, jj };
}
