import { createViewBridge, toolData, type HostContext } from "./bridge.ts";
import { esc, renderView, type Section, type SnapshotData, type ViewState } from "./render.ts";

// Every Jujutsu panel runs this script; <main data-section> picks the section.
// The repository is the tool input's root, else the panel's hostContext.t3.cwd.
const app = document.getElementById("app")!;
const view = (app.dataset.section ?? "command-center") as Section;
const bridge = createViewBridge(window as never, { name: `jujutsu-${view}`, version: "0.2.0" });

let context: HostContext = {};
let args: Record<string, unknown> = {};
let data: SnapshotData | undefined;
let state: ViewState = {};
let timer: ReturnType<typeof setTimeout> | undefined;

const repository = () => {
  const root = typeof args.root === "string" && args.root ? args.root : context.t3?.cwd;
  return root ? { root } : {};
};

function draw() {
  if (data) app.innerHTML = renderView(data, view, state);
  else if (state.error) app.innerHTML = `<p class="error" role="alert">${esc(state.error)}</p><button type="button" data-action="refresh">Retry</button>`;
}

function schedule() {
  clearTimeout(timer);
  // Polling would rebuild an open form and drop what is being typed.
  if (!data || state.editing) return;
  timer = setTimeout(() => void refresh(), data.pollSeconds * 1000);
}

async function refresh() {
  clearTimeout(timer);
  if (document.visibilityState === "hidden") {
    timer = setTimeout(() => void refresh(), 5000);
    return;
  }
  try {
    data = toolData<SnapshotData>(await bridge.callTool("jj_snapshot", repository()));
    state = { ...state, error: undefined };
  } catch (cause) {
    state = { ...state, error: `Refresh failed: ${cause instanceof Error ? cause.message : cause}` };
  }
  draw();
  schedule();
}

async function mutate(tool: string, input: Record<string, string>) {
  if (!data) return;
  state = { busy: true };
  draw();
  try {
    const result = toolData<Partial<SnapshotData> & { done: string; refreshError?: string }>(await bridge.callTool(tool, { root: data.root, ...input }));
    state = { notice: result.done };
    if (result.snapshot) data = result as SnapshotData;
    else await refresh();
  } catch (cause) {
    state = { ...state, busy: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
  state.busy = false;
  draw();
  schedule();
}

bridge.onHostContext = (update) => {
  const previous = context.t3?.cwd;
  context = { ...context, ...update };
  if (context.theme) document.documentElement.dataset.theme = context.theme;
  // A thread panel follows the active thread's worktree.
  if (data && context.t3?.cwd !== previous && typeof args.root !== "string") void refresh();
};
bridge.onToolInput = (input) => {
  args = input;
};
bridge.onToolResult = (result) => {
  if (result.isError) {
    data = undefined;
    state = { error: result.content?.find((part) => part.type === "text")?.text ?? "Jujutsu snapshot failed." };
  } else {
    data = toolData<SnapshotData>(result);
    state = {};
  }
  draw();
  schedule();
};

app.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  const action = target?.dataset.action;
  if (!action) return;
  const changeId = target.dataset.changeId ?? "";
  if (action === "refresh") void refresh();
  else if (action === "cancel") {
    state = {};
    draw();
    schedule();
  } else if (action.startsWith("edit-")) {
    state = { editing: { kind: action.slice(5) as "describe" | "rebase" | "squash" | "abandon", changeId } };
    clearTimeout(timer);
    draw();
    app.querySelector<HTMLInputElement>(".editor input")?.focus();
  } else if (action === "confirm-squash") void mutate("jj_squash", { revision: changeId });
  else if (action === "confirm-abandon") void mutate("jj_abandon", { revision: changeId });
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const value = (name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value.trim() ?? "";
  const changeId = form.dataset.changeId ?? "";
  if (form.dataset.form === "describe") void mutate("jj_describe", { revision: changeId, message: value("message") });
  if (form.dataset.form === "rebase") void mutate("jj_rebase", { revision: changeId, destination: value("destination") });
  if (form.dataset.form === "bookmark-create") void mutate("jj_bookmark_create", { name: value("name"), revision: value("revision") || "@" });
});

new ResizeObserver(() => bridge.sendSize(document.documentElement.scrollWidth, document.documentElement.scrollHeight)).observe(document.body);

// After a tool call the host delivers its result; a panel opened from a command
// only loads the resource, so fetch if nothing arrives.
void bridge.connect().then(() => setTimeout(() => void (data || state.error ? undefined : refresh()), 250));
