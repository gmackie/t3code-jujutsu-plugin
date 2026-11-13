import { describe, expect, it } from "bun:test";

import { buildJjSurfaceModel, normalizeJjSnapshot } from "../jj.ts";
import { renderView, type SnapshotData } from "./render.ts";

function data(overrides: { mutationsEnabled?: boolean; conflict?: boolean } = {}): SnapshotData {
  const snapshot = normalizeJjSnapshot({
    repoRoot: "/work/project",
    workingCopy: { changeId: "zzyy", description: "Fix <script>alert(1)</script>", empty: false, conflicts: overrides.conflict ? 1 : 0 },
    changes: [
      { changeId: "zzyy", commitId: "abc", description: "Fix <script>alert(1)</script>", author: "me@x", bookmarks: ["feature"], conflict: overrides.conflict ?? false, isWorkingCopy: true },
      { changeId: "xxww", commitId: "def", description: "Base", author: "me@x", bookmarks: ["main"] },
    ],
    operations: [{ id: "op1", description: "rebase", user: "me", timestamp: "2026-11-13T14:50:39-06:00" }],
    bookmarks: [{ name: "feature", target: "zzyy" }, { name: "main", target: "xxww", diverged: true }],
    workspaces: [{ name: "default", revision: "zzyy" }],
    conflictedPaths: overrides.conflict ? ["src/a.ts"] : [],
  });
  const mutationsEnabled = overrides.mutationsEnabled ?? false;
  return { root: "/work/project", snapshot, surface: buildJjSurfaceModel(snapshot, { mutationsEnabled }), mutationsEnabled, pollSeconds: 30, refreshedAt: "2026-11-13T21:00:00Z" };
}

describe("view renderers", () => {
  it("escapes repository text and hides change actions while read-only", () => {
    const html = renderView(data(), "command-center");
    expect(html).toContain("Fix &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('data-action="edit-');
    expect(html).not.toContain('data-form="bookmark-create"');
    expect(html).toContain("JJ_MUTATIONS=enabled");
    // No conflicts: the command center leaves the section out.
    expect(html).not.toContain('aria-label="Conflicts"');
  });

  it("renders one section per panel", () => {
    expect(renderView(data(), "operation-log")).toContain("rebase");
    expect(renderView(data(), "operation-log")).not.toContain('aria-label="Changes"');
    expect(renderView(data(), "bookmarks")).toContain("conflicted");
    expect(renderView(data(), "workspaces")).toContain("default");
    expect(renderView(data(), "conflicts")).toContain("No conflicts in the visible changes.");
    const conflicts = renderView(data({ conflict: true }), "conflicts");
    expect(conflicts).toContain("src/a.ts");
    expect(conflicts).toContain('<span class="mono">zzyy</span>');
    expect(conflicts).not.toContain("xxww");
  });

  it("offers guarded change actions and confirmation only when enabled", () => {
    const enabled = data({ mutationsEnabled: true });
    expect(renderView(enabled, "change-graph")).toContain('data-action="edit-abandon" data-change-id="xxww"');
    const confirm = renderView(enabled, "change-graph", { editing: { kind: "abandon", changeId: "xxww" }, busy: true });
    expect(confirm).toContain('data-action="confirm-abandon" data-change-id="xxww" disabled');
    const describe = renderView(enabled, "change-graph", { editing: { kind: "describe", changeId: "zzyy" }, error: "jj describe failed: <boom>" });
    expect(describe).toContain('data-form="describe" data-change-id="zzyy"');
    expect(describe).toContain('value="Fix &lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(describe).toContain('role="alert">jj describe failed: &lt;boom&gt;');
    expect(renderView(enabled, "bookmarks")).toContain('data-form="bookmark-create"');
  });
});
