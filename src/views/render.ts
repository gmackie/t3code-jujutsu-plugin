// Pure HTML renderers shared by the ui:// views (bundled into the browser) and
// the tests. All dynamic text goes through esc().
import type { JjChange, JjSnapshot, JjSurfaceModel } from "../jj.ts";

export type Section = "command-center" | "change-graph" | "operation-log" | "bookmarks" | "workspaces" | "conflicts";

/** structuredContent of jj_snapshot and of a mutation that refreshed. */
export type SnapshotData = {
  root: string;
  snapshot: JjSnapshot;
  surface: JjSurfaceModel;
  mutationsEnabled: boolean;
  pollSeconds: number;
  refreshedAt: string;
  done?: string;
};

export type Editing = { kind: "describe" | "rebase" | "squash" | "abandon"; changeId: string };
export type ViewState = { busy?: boolean; error?: string; notice?: string; editing?: Editing };

export const SECTION_TITLES: Record<Section, string> = {
  "command-center": "Jujutsu",
  "change-graph": "Change graph",
  "operation-log": "Operation log",
  bookmarks: "Bookmarks",
  workspaces: "Workspaces",
  conflicts: "Conflicts",
};

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const time = (iso?: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};
const pill = (label: string, tone: string) => `<span class="pill pill-${esc(tone)}">${esc(label)}</span>`;
const disabled = (state: ViewState) => (state.busy ? " disabled" : "");
const empty = (text: string) => `<li class="empty">${esc(text)}</li>`;
const section = (label: string, count: number | undefined, body: string) =>
  `<section aria-label="${esc(label)}"><h2>${esc(label)}${count === undefined ? "" : ` <span class="count">${count}</span>`}</h2>${body}</section>`;

function changeEditor(change: JjChange, editing: Editing, state: ViewState): string {
  const id = esc(change.changeId);
  switch (editing.kind) {
    case "describe":
      return `<form class="editor" data-form="describe" data-change-id="${id}"><input name="message" aria-label="Description for ${id}" value="${esc(change.description === "(no description)" ? "" : change.description)}" autocomplete="off" required><button type="submit" class="primary"${disabled(state)}>Save</button><button type="button" data-action="cancel">Cancel</button></form>`;
    case "rebase":
      return `<form class="editor" data-form="rebase" data-change-id="${id}"><label class="field">Onto <input name="destination" aria-label="Rebase ${id} onto" placeholder="revision, e.g. main" autocomplete="off" required></label><button type="submit" class="primary"${disabled(state)}>Rebase</button><button type="button" data-action="cancel">Cancel</button></form>`;
    case "squash":
    case "abandon":
      return `<div class="editor"><span>${editing.kind === "squash" ? "Squash into its parent, keeping the parent's description?" : "Abandon this change?"}</span><button type="button" class="${editing.kind === "abandon" ? "danger" : "primary"}" data-action="confirm-${editing.kind}" data-change-id="${id}"${disabled(state)}>${editing.kind === "squash" ? "Squash" : "Abandon"}</button><button type="button" data-action="cancel">Cancel</button></div>`;
  }
}

function changeRows(changes: readonly JjChange[], data: SnapshotData, state: ViewState, emptyText: string): string {
  if (!changes.length) return `<ul>${empty(emptyText)}</ul>`;
  return `<ul>${changes
    .map((change) => {
      const id = esc(change.changeId);
      const actions = data.mutationsEnabled
        ? `<div class="row-actions">${(["describe", "rebase", "squash", "abandon"] as const)
            .map((kind) => `<button type="button" data-action="edit-${kind}" data-change-id="${id}"${disabled(state)}>${kind[0]!.toUpperCase()}${kind.slice(1)}</button>`)
            .join("")}</div>`
        : "";
      const editing = state.editing?.changeId === change.changeId ? changeEditor(change, state.editing, state) : "";
      return `<li class="row${change.isWorkingCopy ? " row-current" : ""}">
  <div class="row-main">
    <div class="row-title">${change.isWorkingCopy ? `<span class="at" title="Working copy">@</span> ` : ""}${esc(change.description)}</div>
    <div class="row-meta"><span class="mono">${id}</span><span class="mono">${esc(change.commitId)}</span><span>${esc(change.author)}</span>${change.bookmarks.map((bookmark) => pill(bookmark, "active")).join("")}${change.conflict ? pill("conflict", "warning") : ""}</div>
    ${editing}
  </div>
  ${actions}
</li>`;
    })
    .join("\n")}</ul>`;
}

function operations(data: SnapshotData, limit?: number): string {
  const ops = limit ? data.snapshot.operations.slice(0, limit) : data.snapshot.operations;
  return `<ul>${ops.length ? ops.map((op) => `<li class="row"><div class="row-main"><div class="row-title">${esc(op.description)}</div><div class="row-meta"><span class="mono">${esc(op.id)}</span><span>${esc(op.user)}</span><span>${esc(time(op.timestamp))}</span></div></div></li>`).join("\n") : empty("No operations.")}</ul>`;
}

function bookmarks(data: SnapshotData, state: ViewState): string {
  const rows = data.snapshot.bookmarks.length
    ? data.snapshot.bookmarks.map((bookmark) => `<li class="row"><div class="row-main"><div class="row-title">${esc(bookmark.name)}</div><div class="row-meta"><span class="mono">${esc(bookmark.target || "(no target)")}</span>${bookmark.diverged ? pill("conflicted", "warning") : ""}</div></div></li>`).join("\n")
    : empty("No local bookmarks.");
  const form = data.mutationsEnabled
    ? `<form class="editor" data-form="bookmark-create"><input name="name" aria-label="Bookmark name" placeholder="bookmark name" autocomplete="off" required><input name="revision" aria-label="Bookmark revision" value="@" autocomplete="off" required><button type="submit"${disabled(state)}>Create bookmark</button></form>`
    : "";
  return `<ul>${rows}</ul>${form}`;
}

function workspaces(data: SnapshotData): string {
  return `<ul>${data.snapshot.workspaces.length ? data.snapshot.workspaces.map((workspace) => `<li class="row"><div class="row-main"><div class="row-title">${esc(workspace.name)}</div><div class="row-meta"><span class="mono">${esc(workspace.revision)}</span>${workspace.root ? `<span>${esc(workspace.root)}</span>` : ""}</div></div></li>`).join("\n") : empty("No workspaces.")}</ul>`;
}

function conflicts(data: SnapshotData, state: ViewState): string {
  const conflicted = data.snapshot.changes.filter((change) => change.conflict);
  const paths = data.snapshot.conflictedPaths.length
    ? `<h3>Working copy</h3><ul>${data.snapshot.conflictedPaths.map((path) => `<li class="row"><span class="mono">${esc(path)}</span></li>`).join("")}</ul><p class="row-detail">Edit the files to resolve, or run <span class="mono">jj resolve</span>.</p>`
    : "";
  if (!conflicted.length && !paths) return `<ul>${empty("No conflicts in the visible changes.")}</ul>`;
  return `${paths}${conflicted.length ? `<h3>Conflicted changes</h3>${changeRows(conflicted, data, state, "")}` : ""}`;
}

function overview(data: SnapshotData): string {
  const metrics = data.surface.cards.filter((card) => card.kind === "metric");
  const notice = data.surface.cards.find((card) => card.kind === "notice");
  const wc = data.snapshot.workingCopy;
  return `<div class="metrics">${metrics.map((card) => `<div class="metric metric-${esc(card.status ?? "neutral")}"><div class="metric-value">${esc(card.value)}</div><div class="metric-title">${esc(card.title)}</div></div>`).join("")}</div>
<section aria-label="Working copy"><h2>Working copy</h2>${wc ? `<div class="row"><div class="row-main"><div class="row-title"><span class="at">@</span> ${esc(wc.description || "(no description)")}</div><div class="row-meta"><span class="mono">${esc(wc.changeId ?? "")}</span>${wc.empty ? pill("empty", "neutral") : pill("has changes", "positive")}${wc.conflicts > 0 ? pill(`${wc.conflicts} conflicted`, "warning") : ""}</div></div></div>` : `<p class="empty">No working copy detected.</p>`}</section>
${notice ? `<p class="notice">${esc(notice.message)}</p>` : ""}`;
}

export function renderView(data: SnapshotData, view: Section, state: ViewState = {}): string {
  const { snapshot } = data;
  const header = `<header>
  <h1>${esc(SECTION_TITLES[view])}</h1>
  <div class="header-meta"><span title="${esc(data.root)}">${esc(snapshot.repoRoot ?? data.root)}</span><span>Refreshed ${esc(time(data.refreshedAt))}</span><button type="button" data-action="refresh"${disabled(state)}>Refresh</button></div>
</header>
${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}${state.notice ? `<p class="done" role="status">${esc(state.notice)}</p>` : ""}`;
  // Conflicted changes; the working copy counts even when the log revset hides it.
  const conflictedCount = Math.max(snapshot.changes.filter((change) => change.conflict).length, snapshot.conflictedPaths.length ? 1 : 0);
  switch (view) {
    case "change-graph":
      return header + section("Changes", snapshot.changes.length, changeRows(snapshot.changes, data, state, "No visible changes."));
    case "operation-log":
      return header + section("Operations", snapshot.operations.length, operations(data));
    case "bookmarks":
      return header + section("Bookmarks", snapshot.bookmarks.length, bookmarks(data, state));
    case "workspaces":
      return header + section("Workspaces", snapshot.workspaces.length, workspaces(data));
    case "conflicts":
      return header + section("Conflicts", conflictedCount, conflicts(data, state));
    case "command-center":
      return [
        header,
        overview(data),
        conflictedCount ? section("Conflicts", conflictedCount, conflicts(data, state)) : "",
        section("Changes", snapshot.changes.length, changeRows(snapshot.changes, data, state, "No visible changes.")),
        section("Bookmarks", snapshot.bookmarks.length, bookmarks(data, state)),
        section("Recent operations", undefined, operations(data, 6)),
        section("Workspaces", snapshot.workspaces.length, workspaces(data)),
      ].join("\n");
  }
}

export const STYLES = `
:root { color-scheme: light dark; --fg: #1f2328; --muted: #656d76; --bg: transparent; --line: #d0d7de; --accent: #0969da; --pos: #1a7f37; --neg: #cf222e; --warn: #9a6700; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
:root[data-theme="dark"] { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; color: var(--fg); background: var(--bg); }
header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h1 { font-size: 15px; margin: 0; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; } h3 { font-size: 12px; margin: 10px 0 4px; }
.header-meta { display: flex; gap: 8px; align-items: center; color: var(--muted); flex-wrap: wrap; min-width: 0; } .header-meta span { overflow-wrap: anywhere; }
ul { list-style: none; margin: 0; padding: 0; }
.row { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; border-top: 1px solid var(--line); }
.row-main { flex: 1; min-width: 0; } .row-title { font-weight: 500; overflow-wrap: anywhere; }
.row-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 12px; margin-top: 2px; }
.row-detail { color: var(--muted); font-size: 12px; margin-top: 4px; }
.row-actions { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.at { color: var(--accent); font-weight: 600; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.count { font-weight: 400; } .empty { color: var(--muted); padding: 8px 0; border-top: 1px solid var(--line); margin: 0; }
.pill { border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 11px; line-height: 17px; }
.pill-active { color: var(--accent); } .pill-positive { color: var(--pos); } .pill-negative { color: var(--neg); } .pill-warning { color: var(--warn); } .pill-neutral { color: var(--muted); }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-top: 12px; }
.metric { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; } .metric-value { font-size: 18px; font-weight: 600; } .metric-title { color: var(--muted); font-size: 12px; }
.metric-warning .metric-value { color: var(--warn); }
button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); } button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; } button.danger { background: var(--neg); border-color: var(--neg); color: #fff; }
input { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; min-width: 0; }
.editor { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 8px; } .editor input[name="message"] { flex: 1; }
.field { display: flex; gap: 6px; align-items: center; color: var(--muted); }
.notice { color: var(--muted); font-size: 12px; margin: 12px 0 0; }
.error { color: var(--neg); } .done { color: var(--pos); }
`;
