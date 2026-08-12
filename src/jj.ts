export type JjWorkingCopy = { changeId: string | null; description: string; empty: boolean; conflicts: number };
export type JjChange = { changeId: string; commitId: string; description: string; author: string; bookmarks: readonly string[]; conflict: boolean; isWorkingCopy: boolean };
export type JjOperation = { id: string; description: string; user: string; timestamp: string };
export type JjBookmark = { name: string; target: string; diverged?: boolean };
export type JjWorkspace = { name: string; revision: string; root: string; locked: boolean };
export type JjSnapshot = { repoRoot: string | null; workingCopy: JjWorkingCopy | null; changes: readonly JjChange[]; operations: readonly JjOperation[]; bookmarks: readonly JjBookmark[]; workspaces: readonly JjWorkspace[] };
export type JjSurfaceCard = { kind: "metric" | "list" | "notice"; id: string; title: string; value?: string; message?: string; status?: "neutral" | "positive" | "warning" | "negative"; items?: readonly { id: string; title: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }[] };
export type JjSurfaceModel = { pluginId: string; navigationId: string; title: string; refreshedAt: string; cards: readonly JjSurfaceCard[] };
export type CommandRunner = (command: readonly string[]) => Promise<unknown>;

function string(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function boolean(value: unknown, fallback = false): boolean { return typeof value === "boolean" ? value : fallback; }
function number(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

export function normalizeJjSnapshot(value: any): JjSnapshot {
  const workingCopy = value?.workingCopy && typeof value.workingCopy === "object" ? {
    changeId: typeof value.workingCopy.changeId === "string" ? value.workingCopy.changeId : null,
    description: string(value.workingCopy.description),
    empty: boolean(value.workingCopy.empty, true),
    conflicts: number(value.workingCopy.conflicts),
  } : null;
  return {
    repoRoot: typeof value?.repoRoot === "string" ? value.repoRoot : null,
    workingCopy,
    changes: Array.isArray(value?.changes) ? value.changes.map((change: any) => ({
      changeId: string(change.changeId, "unknown"), commitId: string(change.commitId), description: string(change.description, "(no description)"), author: string(change.author, "Unknown author"),
      bookmarks: Array.isArray(change.bookmarks) ? change.bookmarks.map((bookmark: unknown) => string(bookmark)).filter(Boolean) : [], conflict: boolean(change.conflict), isWorkingCopy: boolean(change.isWorkingCopy),
    })) : [],
    operations: Array.isArray(value?.operations) ? value.operations.map((operation: any) => ({ id: string(operation.id), description: string(operation.description, "(unknown operation)"), user: string(operation.user, "Unknown user"), timestamp: string(operation.timestamp) })) : [],
    bookmarks: Array.isArray(value?.bookmarks) ? value.bookmarks.map((bookmark: any) => ({ name: string(bookmark.name), target: string(bookmark.target), ...(typeof bookmark.diverged === "boolean" ? { diverged: bookmark.diverged } : {}) })) : [],
    workspaces: Array.isArray(value?.workspaces) ? value.workspaces.map((workspace: any) => ({ name: string(workspace.name), revision: string(workspace.revision), root: string(workspace.root), locked: boolean(workspace.locked) })) : [],
  };
}

export function buildJjSurfaceModel(snapshot: JjSnapshot, navigationId = "jujutsu.command-center"): JjSurfaceModel {
  const conflicts = snapshot.workingCopy?.conflicts ?? 0;
  return { pluginId: "com.t3code.jujutsu", navigationId, title: "Jujutsu command center", refreshedAt: new Date().toISOString(), cards: [
    { kind: "metric", id: "changes", title: "Visible changes", value: `${snapshot.changes.length}`, status: snapshot.changes.length > 0 ? "positive" : "neutral" },
    { kind: "metric", id: "bookmarks", title: "Bookmarks", value: `${snapshot.bookmarks.length}`, status: snapshot.bookmarks.length > 0 ? "positive" : "neutral" },
    { kind: "metric", id: "workspaces", title: "Workspaces", value: `${snapshot.workspaces.length}`, status: snapshot.workspaces.length > 0 ? "positive" : "neutral" },
    { kind: "list", id: "working-copy", title: "Working copy", status: conflicts > 0 ? "warning" : "positive", items: [{ id: "working-copy", title: snapshot.workingCopy?.description || "No working copy detected", detail: conflicts > 0 ? `${conflicts} conflict${conflicts === 1 ? "" : "s"} need attention` : snapshot.workingCopy?.empty ? "Empty change" : "Clean enough to continue", status: conflicts > 0 ? "warning" : "positive" }] },
    { kind: "list", id: "change-graph", title: "Change graph", items: snapshot.changes.slice(0, 8).map((change) => ({ id: change.changeId, title: change.description, detail: `${change.changeId} · ${change.author}${change.bookmarks.length > 0 ? ` · ${change.bookmarks.join(", ")}` : ""}`, status: change.conflict ? "warning" as const : "neutral" as const })) },
    { kind: "list", id: "operations", title: "Recent operations", items: snapshot.operations.slice(0, 6).map((operation) => ({ id: operation.id, title: operation.description, detail: `${operation.user} · ${operation.timestamp}` })) },
    { kind: "notice", id: "read-only", title: "Read-only preview", message: "This first slice observes JJ state. Mutations will be added behind explicit action and capability checks." },
  ] };
}

export function createJjClient(input: { projectRoot: string; run: CommandRunner }) { return { async snapshot() { return normalizeJjSnapshot(await input.run(["jj_t3_snapshot", "--root", input.projectRoot, "--json"])); } }; }
