// Jujutsu domain: snapshot types, normalization, the command-center summary,
// native jj collection and the guarded mutation commands.
export type JjWorkingCopy = { changeId: string | null; description: string; empty: boolean; conflicts: number };
export type JjChange = { changeId: string; commitId: string; description: string; author: string; bookmarks: readonly string[]; conflict: boolean; isWorkingCopy: boolean };
export type JjOperation = { id: string; description: string; user: string; timestamp: string };
export type JjBookmark = { name: string; target: string; diverged?: boolean };
export type JjWorkspace = { name: string; revision: string; root: string; locked: boolean };
export type JjSnapshot = {
  repoRoot: string | null;
  workingCopy: JjWorkingCopy | null;
  changes: readonly JjChange[];
  operations: readonly JjOperation[];
  bookmarks: readonly JjBookmark[];
  workspaces: readonly JjWorkspace[];
  /** Conflicted paths in the working-copy commit. */
  conflictedPaths: readonly string[];
};
export type JjStatus = "neutral" | "positive" | "warning" | "negative";
export type JjSurfaceCard = { kind: "metric" | "list" | "notice"; id: string; title: string; value?: string; message?: string; status?: JjStatus; items?: readonly { id: string; title: string; detail?: string; status?: JjStatus }[] };
export type JjSurfaceModel = { pluginId: string; title: string; refreshedAt: string; cards: readonly JjSurfaceCard[] };
/**
 * Runs a full argv (argv[0] is "jj") and resolves with stdout. `cwd` is the
 * repository root: jj prints paths (e.g. `resolve --list`) relative to the
 * process cwd, not to `--repository`.
 */
export type CommandRunner = (command: readonly string[], options?: { cwd?: string }) => Promise<string>;

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
      changeId: string(change.changeId, "unknown"), commitId: string(change.commitId), description: string(change.description) || "(no description)", author: string(change.author) || "Unknown author",
      bookmarks: Array.isArray(change.bookmarks) ? change.bookmarks.map((bookmark: unknown) => string(bookmark)).filter(Boolean) : [], conflict: boolean(change.conflict), isWorkingCopy: boolean(change.isWorkingCopy),
    })) : [],
    operations: Array.isArray(value?.operations) ? value.operations.map((operation: any) => ({ id: string(operation.id), description: string(operation.description) || "(unknown operation)", user: string(operation.user) || "Unknown user", timestamp: string(operation.timestamp) })) : [],
    bookmarks: Array.isArray(value?.bookmarks) ? value.bookmarks.map((bookmark: any) => ({ name: string(bookmark.name), target: string(bookmark.target), ...(typeof bookmark.diverged === "boolean" ? { diverged: bookmark.diverged } : {}) })) : [],
    workspaces: Array.isArray(value?.workspaces) ? value.workspaces.map((workspace: any) => ({ name: string(workspace.name), revision: string(workspace.revision), root: string(workspace.root), locked: boolean(workspace.locked) })) : [],
    conflictedPaths: Array.isArray(value?.conflictedPaths) ? value.conflictedPaths.map((path: unknown) => string(path)).filter(Boolean) : [],
  };
}

export function buildJjSurfaceModel(snapshot: JjSnapshot, options: { mutationsEnabled?: boolean } = {}): JjSurfaceModel {
  const conflicts = snapshot.workingCopy?.conflicts ?? 0;
  const conflicted = snapshot.changes.filter((change) => change.conflict).length;
  return { pluginId: "com.t3code.jujutsu", title: "Jujutsu command center", refreshedAt: new Date().toISOString(), cards: [
    { kind: "metric", id: "changes", title: "Visible changes", value: `${snapshot.changes.length}`, status: snapshot.changes.length > 0 ? "positive" : "neutral" },
    { kind: "metric", id: "conflicts", title: "Conflicted changes", value: `${conflicted}`, status: conflicted > 0 ? "warning" : "positive" },
    { kind: "metric", id: "bookmarks", title: "Bookmarks", value: `${snapshot.bookmarks.length}`, status: snapshot.bookmarks.length > 0 ? "positive" : "neutral" },
    { kind: "metric", id: "workspaces", title: "Workspaces", value: `${snapshot.workspaces.length}`, status: snapshot.workspaces.length > 0 ? "positive" : "neutral" },
    { kind: "list", id: "working-copy", title: "Working copy", status: conflicts > 0 ? "warning" : "positive", items: [{ id: "working-copy", title: snapshot.workingCopy?.description || (snapshot.workingCopy ? "(no description)" : "No working copy detected"), detail: conflicts > 0 ? `${conflicts} conflicted path${conflicts === 1 ? "" : "s"} need attention` : snapshot.workingCopy?.empty ? "Empty change" : "Has changes", status: conflicts > 0 ? "warning" : "positive" }] },
    { kind: "list", id: "change-graph", title: "Change graph", items: snapshot.changes.slice(0, 8).map((change) => ({ id: change.changeId, title: change.description, detail: `${change.changeId} · ${change.author}${change.bookmarks.length > 0 ? ` · ${change.bookmarks.join(", ")}` : ""}`, status: change.conflict ? "warning" as const : "neutral" as const })) },
    { kind: "list", id: "operations", title: "Recent operations", items: snapshot.operations.slice(0, 6).map((operation) => ({ id: operation.id, title: operation.description, detail: `${operation.user} · ${operation.timestamp}` })) },
    options.mutationsEnabled
      ? { kind: "notice", id: "mutations", title: "Changes enabled", message: "Panels can describe, squash, abandon and rebase changes and create bookmarks. Each change runs only when you click it.", status: "neutral" }
      : { kind: "notice", id: "read-only", title: "Read-only", message: "Panels only observe JJ state. Set JJ_MUTATIONS=enabled on the plugin to allow changes from panels." },
  ] };
}

const GLOBAL_FLAGS = ["--no-pager", "--color=never"] as const;

/** Global flags go before the subcommand so a `--` separator never swallows them. */
export function jjCommand(projectRoot: string, args: readonly string[], options: { ignoreWorkingCopy?: boolean } = {}): readonly string[] {
  return ["jj", `--repository=${projectRoot}`, ...GLOBAL_FLAGS, ...(options.ignoreWorkingCopy ? ["--ignore-working-copy"] : []), ...args];
}

const TAB = '"\\t"';
const NL = '"\\n"';
const flag = (expression: string) => `if(${expression}, "1", "0")`;
export const TEMPLATES = {
  workingCopy: ["change_id.short()", "description.first_line()", flag("empty"), flag("conflict")].join(` ++ ${TAB} ++ `) + ` ++ ${NL}`,
  change: ["change_id.short()", "commit_id.short()", "description.first_line()", "author.email()", 'bookmarks.join(",")', flag("conflict"), flag("current_working_copy")].join(` ++ ${TAB} ++ `) + ` ++ ${NL}`,
  operation: ["id.short()", "description.first_line()", "user", 'time.end().format("%Y-%m-%dT%H:%M:%S%:z")'].join(` ++ ${TAB} ++ `) + ` ++ ${NL}`,
  bookmark: ["name", 'if(remote, remote, "")', flag("conflict"), 'if(normal_target, normal_target.change_id().short(), "")'].join(` ++ ${TAB} ++ `) + ` ++ ${NL}`,
  workspace: ["name", "target.change_id().short()"].join(` ++ ${TAB} ++ `) + ` ++ ${NL}`,
} as const;

const lines = (output: string) => output.split("\n").filter((line) => line.trim() !== "");

/** Splits a tab row whose free-text field (at `free`) may itself contain tabs. */
function fields(line: string, count: number, free: number): string[] | null {
  const parts = line.split("\t");
  if (parts.length < count) return null;
  const tail = count - free - 1;
  return [...parts.slice(0, free), parts.slice(free, parts.length - tail).join("\t"), ...parts.slice(parts.length - tail)];
}

export function parseWorkingCopy(output: string): Omit<JjWorkingCopy, "conflicts"> & { conflict: boolean } | null {
  const row = lines(output)[0];
  const parts = row ? fields(row, 4, 1) : null;
  return parts ? { changeId: parts[0] || null, description: parts[1]!, empty: parts[2] === "1", conflict: parts[3] === "1" } : null;
}

export function parseChanges(output: string): readonly JjChange[] {
  return lines(output).flatMap((line) => {
    const parts = fields(line, 7, 2);
    if (!parts) return [];
    return [{ changeId: parts[0]!, commitId: parts[1]!, description: parts[2] || "(no description)", author: parts[3] || "Unknown author", bookmarks: parts[4] ? parts[4].split(",").filter(Boolean) : [], conflict: parts[5] === "1", isWorkingCopy: parts[6] === "1" }];
  });
}

export function parseOperations(output: string): readonly JjOperation[] {
  return lines(output).flatMap((line) => {
    const parts = fields(line, 4, 1);
    return parts ? [{ id: parts[0]!, description: parts[1] || "(unknown operation)", user: parts[2] || "Unknown user", timestamp: parts[3]! }] : [];
  });
}

/** Local bookmarks only; remote-tracking rows are skipped. */
export function parseBookmarks(output: string): readonly JjBookmark[] {
  return lines(output).flatMap((line) => {
    const [name, remote, conflict, target] = line.split("\t");
    if (!name || remote) return [];
    return [{ name, target: target ?? "", diverged: conflict === "1" }];
  });
}

export function parseWorkspaces(output: string): readonly JjWorkspace[] {
  return lines(output).flatMap((line) => {
    const [name, revision] = line.split("\t");
    return name ? [{ name, revision: revision ?? "", root: "", locked: false }] : [];
  });
}

/**
 * `jj resolve --list` rows are `<path> <n>-sided conflict[ including …]`; the
 * padding before the suffix can be a single space for long paths.
 */
export function parseConflictedPaths(output: string): readonly string[] {
  return lines(output).map((line) => line.replace(/\s+\d+-sided conflict\b.*$/, "").trim()).filter(Boolean);
}

export function createBuiltinJjClient(input: { projectRoot: string; run: CommandRunner; changeLimit?: number }) {
  const at = (args: readonly string[], ignoreWorkingCopy = true) => input.run(jjCommand(input.projectRoot, args, { ignoreWorkingCopy }), { cwd: input.projectRoot });
  return {
    async snapshot(): Promise<JjSnapshot> {
      // The first command snapshots the working copy; the rest read that
      // operation in parallel without racing each other to snapshot it again.
      const workingCopy = parseWorkingCopy(await at(["log", "-r", "@", "--no-graph", "-T", TEMPLATES.workingCopy], false));
      const [root, log, operations, bookmarks, workspaces, conflicts] = await Promise.all([
        at(["root"]),
        at(["log", "-n", String(input.changeLimit ?? 40), "--no-graph", "-T", TEMPLATES.change]),
        at(["op", "log", "-n", "20", "--no-graph", "-T", TEMPLATES.operation]),
        at(["bookmark", "list", "-T", TEMPLATES.bookmark]),
        at(["workspace", "list", "-T", TEMPLATES.workspace]),
        workingCopy?.conflict ? at(["resolve", "--list", "-r", "@"]) : Promise.resolve(""),
      ]);
      const conflictedPaths = parseConflictedPaths(conflicts);
      return normalizeJjSnapshot({
        repoRoot: root.trim(),
        workingCopy: workingCopy ? { changeId: workingCopy.changeId, description: workingCopy.description, empty: workingCopy.empty, conflicts: workingCopy.conflict ? Math.max(1, conflictedPaths.length) : 0 } : null,
        changes: parseChanges(log),
        operations: parseOperations(operations),
        bookmarks: parseBookmarks(bookmarks),
        workspaces: parseWorkspaces(workspaces),
        conflictedPaths,
      });
    },
  };
}

export type JjMutation =
  | { action: "describe"; revision?: string; message: string }
  | { action: "abandon"; revision: string }
  | { action: "squash"; revision: string }
  | { action: "rebase"; revision: string; destination: string }
  | { action: "bookmark-create"; name: string; revision: string };

function revset(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new Error(`${label} is required`);
  // A leading "-" would be read as a flag; jj revsets never need one.
  if (trimmed.startsWith("-") || /[\r\n\0]/.test(trimmed) || trimmed.length > 256) throw new Error(`${label} "${trimmed.slice(0, 40)}" is not a valid revision`);
  return trimmed;
}

/** Builds the jj arguments for a mutation, rejecting input that could be read as a flag. */
export function mutationArgs(mutation: JjMutation): readonly string[] {
  switch (mutation.action) {
    case "describe": {
      const message = mutation.message.trim();
      if (!message) throw new Error("A description is required");
      if (message.length > 10_000 || message.includes("\0")) throw new Error("The description is too long");
      return ["describe", `--message=${message}`, "--", revset(mutation.revision ?? "@", "Revision")];
    }
    case "abandon":
      return ["abandon", "--", revset(mutation.revision, "Revision")];
    case "squash":
      // Keeps the parent's description so jj never needs an editor.
      return ["squash", `--revision=${revset(mutation.revision, "Revision")}`, "--use-destination-message"];
    case "rebase":
      return ["rebase", `--revisions=${revset(mutation.revision, "Revision")}`, `--onto=${revset(mutation.destination, "Destination")}`];
    case "bookmark-create": {
      const name = revset(mutation.name, "Bookmark name");
      if (/\s/.test(name)) throw new Error("Bookmark names cannot contain spaces");
      return ["bookmark", "create", `--revision=${revset(mutation.revision, "Revision")}`, "--", name];
    }
  }
}

export function describeMutation(mutation: JjMutation): string {
  switch (mutation.action) {
    case "describe": return `Described ${mutation.revision?.trim() || "@"}.`;
    case "abandon": return `Abandoned ${mutation.revision.trim()}.`;
    case "squash": return `Squashed ${mutation.revision.trim()} into its parent.`;
    case "rebase": return `Rebased ${mutation.revision.trim()} onto ${mutation.destination.trim()}.`;
    case "bookmark-create": return `Created bookmark ${mutation.name.trim()} at ${mutation.revision.trim()}.`;
  }
}
