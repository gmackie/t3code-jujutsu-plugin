import { expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import manifest from "../t3-plugin.json";

const pluginRoot = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

async function launch(cwd: string, env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: manifest.mcpServer.transport.command,
    args: manifest.mcpServer.transport.args.map((arg) => arg.replaceAll("${pluginRoot}", pluginRoot)),
    cwd,
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  const client = new Client({ name: "installation-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

it("launches the installed manifest from another directory and serves its panels", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "jujutsu-install-"));
  // A jj stand-in that behaves like jj outside a repository.
  const fakeJj = join(cwd, "fake-jj");
  await writeFile(fakeJj, `#!/bin/sh\necho 'Error: There is no jj repo in "."' >&2\nexit 1\n`);
  await chmod(fakeJj, 0o755);
  const client = await launch(cwd, { JJ_BIN: fakeJj });
  try {
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("jj_snapshot");
    const resources = (await client.listResources()).resources;
    for (const panel of manifest.contributes.panels) {
      expect(resources.some((resource) => resource.uri === panel.resourceUri)).toBe(true);
      const view = await client.readResource({ uri: panel.resourceUri });
      expect(view.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
      expect(view.contents[0]).toHaveProperty("text", expect.stringContaining("ui/initialize"));
    }
    // With no root configured, the server reads its own working directory.
    const snapshot = (await client.callTool({ name: "jj_snapshot", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
    expect(snapshot.isError).toBe(true);
    expect(snapshot.content[0]?.text).toContain("jj git init --colocate");
  } finally {
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

const jjInstalled = Bun.which("jj") !== null;

it.skipIf(!jjInstalled)("reads and changes a real jj repository", async () => {
  const repo = await mkdtemp(join(tmpdir(), "jujutsu-repo-"));
  const env = { HOME: repo, JJ_USER: "Test", JJ_EMAIL: "test@example.com", JJ_CONFIG: join(repo, "jj-config.toml") };
  await writeFile(env.JJ_CONFIG, "");
  const jj = (...args: string[]) => Bun.spawnSync(["jj", ...args], { cwd: repo, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  expect(jj("git", "init").exitCode).toBe(0);
  await writeFile(join(repo, "a.txt"), "a\n");
  expect(jj("describe", "-m", "First change").exitCode).toBe(0);
  expect(jj("new").exitCode).toBe(0);
  const client = await launch(tmpdir(), { ...env, JJ_PROJECT_ROOT: repo, JJ_MUTATIONS: "enabled" });
  try {
    type Data = { snapshot: { changes: { changeId: string; description: string; isWorkingCopy: boolean }[]; workspaces: { name: string }[]; operations: unknown[] } };
    const result = (await client.callTool({ name: "jj_snapshot", arguments: {} })) as { isError?: boolean; structuredContent: Data; content: { text: string }[] };
    expect(result.isError).toBeFalsy();
    const first = result.structuredContent.snapshot.changes.find((change) => change.description === "First change");
    expect(first).toBeDefined();
    expect(result.structuredContent.snapshot.changes.some((change) => change.isWorkingCopy)).toBe(true);
    expect(result.structuredContent.snapshot.workspaces.map((workspace) => workspace.name)).toEqual(["default"]);
    expect(result.structuredContent.snapshot.operations.length).toBeGreaterThan(0);

    const bookmark = (await client.callTool({ name: "jj_bookmark_create", arguments: { name: "feat", revision: first!.changeId } })) as { isError?: boolean; content: { text: string }[]; structuredContent: { snapshot: { bookmarks: { name: string; target: string }[] } } };
    expect(bookmark.isError).toBeFalsy();
    expect(bookmark.structuredContent.snapshot.bookmarks).toEqual([{ name: "feat", target: first!.changeId, diverged: false } as never]);
  } finally {
    await client.close();
    await rm(repo, { recursive: true, force: true });
  }
});
