import { describe, expect, it } from "bun:test";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { connectedClient, fakeJj, subcommand } from "./testing.ts";

type Structured<T> = { structuredContent?: T; isError?: boolean; content: { type: string; text?: string }[] };
type Client = Awaited<ReturnType<typeof connectedClient>>["client"];
const call = async <T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as unknown as Structured<T>;
const MUTATIONS = ["jj_abandon", "jj_bookmark_create", "jj_describe", "jj_rebase", "jj_squash"];

describe("Jujutsu MCP server", () => {
  it("links the snapshot tool to the command center and keeps mutations away from the model", async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual([...MUTATIONS, "jj_snapshot"].sort());
    expect(byName.get("jj_snapshot")?._meta).toMatchObject({ ui: { resourceUri: "ui://jujutsu/command-center.html", visibility: ["model", "app"] } });
    expect(byName.get("jj_snapshot")?.annotations?.readOnlyHint).toBe(true);
    for (const name of MUTATIONS) expect(byName.get(name)?._meta).toEqual({ ui: { visibility: ["app"] } });
    expect(byName.get("jj_abandon")?.annotations?.destructiveHint).toBe(true);
  });

  it("serves each panel as a self-contained MCP App resource", async () => {
    const { client } = await connectedClient();
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(["command-center", "change-graph", "operation-log", "bookmarks", "workspaces", "conflicts"].map((name) => `ui://jujutsu/${name}.html`));
    for (const resource of resources) {
      const { contents } = await client.readResource({ uri: resource.uri });
      const html = (contents[0] as { text: string }).text;
      expect(contents[0]?.mimeType).toBe(RESOURCE_MIME_TYPE);
      expect(html).toStartWith("<!doctype html>");
      expect(html).toContain("ui/initialize");
      expect(html).toContain(`data-section="${resource.uri.slice("ui://jujutsu/".length, -".html".length)}"`);
      // T3's sandbox CSP is default-src 'none': nothing may load from outside.
      expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
      expect(html.length).toBeLessThan(100_000);
    }
  });

  it("reads the repository and summarizes it for agents", async () => {
    const { client, jj } = await connectedClient({ config: { pollSeconds: 45 } });
    const result = await call<{ root: string; pollSeconds: number; mutationsEnabled: boolean; snapshot: { changes: unknown[]; conflictedPaths: string[] } }>(client, "jj_snapshot");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ root: "/work/project", pollSeconds: 45, mutationsEnabled: false, snapshot: { conflictedPaths: ["src/a.ts"] } });
    expect(result.structuredContent?.snapshot.changes).toHaveLength(2);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Working copy @ zzyy: Draft <feature>, conflicts in src/a.ts");
    expect(text).toContain("- @ zzyy Draft <feature> [feature] (conflict)");
    expect(text).toContain("Bookmarks: feature→zzyy, main→xxww");
    expect(jj.mutations).toEqual([]);
  });

  it("reads the repository the call names, else JJ_PROJECT_ROOT", async () => {
    const jj = fakeJj();
    const { client } = await connectedClient({ run: jj.run, config: { projectRoot: "/configured" } });
    await call(client, "jj_snapshot");
    expect(jj.commands.at(-1)?.[1]).toBe("--repository=/configured");
    await call(client, "jj_snapshot", { root: "/thread/worktree" });
    expect(jj.commands.at(-1)?.[1]).toBe("--repository=/thread/worktree");
    const relative = await call(client, "jj_snapshot", { root: "relative/path" });
    expect(relative.isError).toBe(true);
    expect(relative.content[0]?.text).toContain("must be absolute");
  });

  it("reports jj failures as tool errors instead of an empty repository", async () => {
    const jj = fakeJj({ fail: (command) => (subcommand(command) === "op log" ? new Error("jj op log timed out after 15s") : undefined) });
    const { client } = await connectedClient({ run: jj.run });
    const result = await call(client, "jj_snapshot");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("jj op log timed out after 15s");
    expect(result.structuredContent).toBeUndefined();
  });

  it("refuses mutations unless JJ_MUTATIONS is enabled", async () => {
    const { client, jj } = await connectedClient();
    for (const [name, args] of [["jj_describe", { message: "x" }], ["jj_abandon", { revision: "zzyy" }], ["jj_bookmark_create", { name: "b", revision: "@" }]] as const) {
      const result = await call(client, name, args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("JJ_MUTATIONS=enabled");
    }
    expect(jj.mutations).toEqual([]);
  });

  it("runs an enabled mutation and returns the refreshed snapshot", async () => {
    const { client, jj } = await connectedClient({ config: { mutationsEnabled: true } });
    const result = await call<{ done: string; snapshot: unknown; root: string }>(client, "jj_rebase", { revision: "zzyy", destination: "main", root: "/work/project" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ done: "Rebased zzyy onto main.", root: "/work/project", snapshot: expect.anything() });
    expect(jj.mutations).toEqual([["rebase", "--revisions=zzyy", "--onto=main"]]);

    const invalid = await call(client, "jj_abandon", { revision: "--ignore-immutable" });
    expect(invalid.isError).toBe(true);
    expect(jj.mutations).toHaveLength(1);
  });

  it("reports a failed mutation, and a landed one whose refresh failed, honestly", async () => {
    let failRefresh = false;
    const jj = fakeJj({
      fail: (command) => {
        if (subcommand(command) === "squash") return new Error("jj squash failed: Commit 000000000000 is immutable");
        if (failRefresh && subcommand(command) === "root") return new Error("jj root timed out after 15s");
        return undefined;
      },
    });
    const { client } = await connectedClient({ run: jj.run, config: { mutationsEnabled: true } });
    const failed = await call(client, "jj_squash", { revision: "root()" });
    expect(failed).toMatchObject({ isError: true, content: [{ text: "jj squash failed: Commit 000000000000 is immutable" }] });

    failRefresh = true;
    const landed = await call<{ done: string; refreshError: string; snapshot?: unknown }>(client, "jj_describe", { message: "Ship it" });
    expect(landed.isError).toBeFalsy();
    expect(landed.structuredContent).toMatchObject({ done: "Described @.", refreshError: "jj root timed out after 15s" });
    expect(landed.structuredContent?.snapshot).toBeUndefined();
  });
});
