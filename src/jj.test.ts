import { describe, expect, test } from "bun:test";
import { buildJjSurfaceModel, createBuiltinJjClient, jjCommand, mutationArgs, normalizeJjSnapshot, parseBookmarks, parseChanges, parseConflictedPaths, parseOperations } from "./jj.ts";
import { fakeJj, subcommand } from "./testing.ts";

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
  conflictedPaths: ["src/a.ts"],
};

describe("Jujutsu adapter", () => {
  test("normalizes a JJ snapshot without inventing repository state", () => {
    expect(normalizeJjSnapshot(raw)).toMatchObject({ ...raw, changes: [raw.changes[0], expect.objectContaining(raw.changes[1])] });
    expect(normalizeJjSnapshot({})).toMatchObject({ repoRoot: null, workingCopy: null, changes: [], operations: [], bookmarks: [], workspaces: [], conflictedPaths: [] });
  });

  test("builds a decision-oriented JJ command center", () => {
    const surface = buildJjSurfaceModel(normalizeJjSnapshot(raw));
    expect(surface.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "working-copy", status: "warning" }),
      expect.objectContaining({ id: "conflicts", value: "1", status: "warning" }),
      expect.objectContaining({ id: "change-graph" }),
      expect.objectContaining({ id: "operations" }),
      expect.objectContaining({ id: "bookmarks" }),
      expect.objectContaining({ id: "workspaces" }),
      expect.objectContaining({ id: "read-only" }),
    ]));
    expect(buildJjSurfaceModel(normalizeJjSnapshot(raw), { mutationsEnabled: true }).cards).toContainEqual(expect.objectContaining({ id: "mutations" }));
  });

  test("parses jj template output, including tabs in descriptions", () => {
    expect(parseChanges("zzyy\tabc\tFix\ttabs\tme@x\tfeature,wip\t1\t1\n")).toEqual([{ changeId: "zzyy", commitId: "abc", description: "Fix\ttabs", author: "me@x", bookmarks: ["feature", "wip"], conflict: true, isWorkingCopy: true }]);
    expect(parseChanges("zzzz\t0000\t\t\t\t0\t0\n")).toEqual([expect.objectContaining({ description: "(no description)", author: "Unknown author", bookmarks: [] })]);
    expect(parseOperations("op1\tsnapshot working copy\tme@host\t2026-11-13T14:50:39-06:00\n")).toEqual([{ id: "op1", description: "snapshot working copy", user: "me@host", timestamp: "2026-11-13T14:50:39-06:00" }]);
    expect(parseBookmarks("main\t\t0\txxww\nmain\torigin\t0\txxww\nsplit\t\t1\t\n")).toEqual([{ name: "main", target: "xxww", diverged: false }, { name: "split", target: "", diverged: true }]);
    expect(parseConflictedPaths("a.txt    2-sided conflict\ndir/b c.ts    3-sided conflict\n")).toEqual(["a.txt", "dir/b c.ts"]);
    // Long paths get a single space before the suffix.
    expect(parseConflictedPaths("some/very/long/directory/name/file.txt 2-sided conflict\nx.bin    2-sided conflict including an executable\n")).toEqual(["some/very/long/directory/name/file.txt", "x.bin"]);
  });

  test("collects a snapshot from native JJ commands", async () => {
    const jj = fakeJj();
    const client = createBuiltinJjClient({ projectRoot: "/work/project", run: jj.run });
    await expect(client.snapshot()).resolves.toMatchObject({
      repoRoot: "/work/project",
      workingCopy: { changeId: "zzyy", conflicts: 1, empty: false },
      changes: expect.arrayContaining([expect.objectContaining({ changeId: "zzyy", isWorkingCopy: true, conflict: true, bookmarks: ["feature"] })]),
      bookmarks: [{ name: "feature", target: "zzyy", diverged: false }, { name: "main", target: "xxww", diverged: false }],
      workspaces: [expect.objectContaining({ name: "default" }), expect.objectContaining({ name: "review" })],
      conflictedPaths: ["src/a.ts"],
    });
    // The working-copy read runs first and is the only one allowed to snapshot.
    expect(subcommand(jj.commands[0]!)).toBe("log");
    expect(jj.commands[0]).not.toContain("--ignore-working-copy");
    expect(jj.commands.slice(1).every((command) => command.includes("--ignore-working-copy"))).toBe(true);
    expect(jj.commands.map(subcommand).sort()).toEqual(["bookmark list", "log", "log", "op log", "resolve", "root", "workspace list"]);
    expect(jj.commands.every((command) => command[1] === "--repository=/work/project")).toBe(true);
    // jj prints paths relative to the process cwd, so every command runs in the repository.
    expect(jj.cwds.every((cwd) => cwd === "/work/project")).toBe(true);
  });

  test("builds mutation commands that cannot smuggle flags", () => {
    expect(mutationArgs({ action: "describe", message: "-rf everything" })).toEqual(["describe", "--message=-rf everything", "--", "@"]);
    expect(mutationArgs({ action: "abandon", revision: "zzyy" })).toEqual(["abandon", "--", "zzyy"]);
    expect(mutationArgs({ action: "squash", revision: "zzyy" })).toEqual(["squash", "--revision=zzyy", "--use-destination-message"]);
    expect(mutationArgs({ action: "rebase", revision: "zzyy", destination: "main" })).toEqual(["rebase", "--revisions=zzyy", "--onto=main"]);
    expect(mutationArgs({ action: "bookmark-create", name: "feat", revision: "@" })).toEqual(["bookmark", "create", "--revision=@", "--", "feat"]);
    expect(() => mutationArgs({ action: "abandon", revision: "--ignore-immutable" })).toThrow("not a valid revision");
    expect(() => mutationArgs({ action: "rebase", revision: "zzyy", destination: "" })).toThrow("Destination is required");
    expect(() => mutationArgs({ action: "bookmark-create", name: "two words", revision: "@" })).toThrow("spaces");
    expect(() => mutationArgs({ action: "describe", message: "   " })).toThrow("description is required");
    expect(jjCommand("/r", ["abandon", "--", "x"])).toEqual(["jj", "--repository=/r", "--no-pager", "--color=never", "abandon", "--", "x"]);
  });
});
