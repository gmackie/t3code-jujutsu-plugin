import { describe, expect, test } from "bun:test";
import { buildJjSurfaceModel, createJjClient, normalizeJjSnapshot } from "./jj.ts";

const raw = {
  repoRoot: "/work/project",
  workingCopy: { changeId: "zzyy", description: "Draft feature", empty: false, conflicts: 1 },
  changes: [
    { changeId: "zzyy", commitId: "abc123", description: "Draft feature", author: "Mackie", bookmarks: ["feature"], conflict: true, isWorkingCopy: true },
    { changeId: "xxww", commitId: "def456", description: "Base", author: "Mackie", bookmarks: ["main"] },
  ],
  operations: [{ id: "op-1", description: "commit", user: "Mackie", timestamp: "2026-08-12T12:00:00Z" }],
  bookmarks: [{ name: "feature", target: "zzyy" }, { name: "main", target: "xxww" }],
  workspaces: [{ name: "default", revision: "zzyy", root: "/work/project", locked: false }],
};

describe("Jujutsu adapter", () => {
  test("normalizes a JJ snapshot without inventing repository state", () => {
    expect(normalizeJjSnapshot(raw)).toMatchObject({ ...raw, changes: [raw.changes[0], expect.objectContaining(raw.changes[1])] });
    expect(normalizeJjSnapshot({})).toMatchObject({ repoRoot: null, changes: [], operations: [], bookmarks: [], workspaces: [] });
  });

  test("builds a decision-oriented JJ command center", () => {
    const surface = buildJjSurfaceModel(normalizeJjSnapshot(raw));
    expect(surface.navigationId).toBe("jujutsu.command-center");
    expect(surface.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "working-copy", status: "warning" }),
      expect.objectContaining({ id: "change-graph" }),
      expect.objectContaining({ id: "operations" }),
      expect.objectContaining({ id: "bookmarks" }),
      expect.objectContaining({ id: "workspaces" }),
    ]));
  });

  test("loads the snapshot through a configured JJ command", async () => {
    const commands: string[][] = [];
    const client = createJjClient({ projectRoot: "/work/project", run: async (command) => {
      commands.push([...command]);
      return raw;
    } });
    await expect(client.snapshot()).resolves.toMatchObject({ repoRoot: "/work/project" });
    expect(commands).toEqual([["jj_t3_snapshot", "--root", "/work/project", "--json"]]);
  });
});
