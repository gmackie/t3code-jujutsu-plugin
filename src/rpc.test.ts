import { describe, expect, test } from "bun:test";
import { createRpcHandler } from "./rpc.ts";

const snapshot = { repoRoot: "/work/project", workingCopy: { changeId: "zzyy", description: "Draft", empty: false, conflicts: 0 }, changes: [], operations: [], bookmarks: [], workspaces: [] };

describe("Jujutsu RPC", () => {
  test("serves the command center and repository snapshot", async () => {
    const handler = createRpcHandler({ snapshot, refresh: async () => snapshot });
    await expect(handler("surface.get", { navigationId: "jujutsu.command-center" })).resolves.toMatchObject({ ok: true, result: { navigationId: "jujutsu.command-center" } });
    await expect(handler("panel.get", { panelId: "jujutsu.command-center" })).resolves.toMatchObject({ ok: true, result: { content: { kind: "command-center", snapshot } } });
  });

  test("serves focused JJ panels", async () => {
    const detailed = { ...snapshot, bookmarks: [{ name: "main", target: "abc" }], operations: [{ id: "op-1", description: "commit", user: "Mackie", timestamp: "now" }] };
    const handler = createRpcHandler({ snapshot: detailed, refresh: async () => detailed });
    await expect(handler("panel.get", { panelId: "jujutsu.change-graph" })).resolves.toMatchObject({ ok: true, result: { content: { kind: "change-graph" } } });
    await expect(handler("panel.get", { panelId: "jujutsu.operation-log" })).resolves.toMatchObject({ ok: true, result: { content: { kind: "operation-log", operations: detailed.operations } } });
    await expect(handler("panel.get", { panelId: "jujutsu.bookmarks" })).resolves.toMatchObject({ ok: true, result: { content: { kind: "bookmarks", bookmarks: detailed.bookmarks } } });
  });
});
