import { buildJjSurfaceModel, type JjMutationInput, type JjSnapshot } from "./jj.ts";

export function createRpcHandler(coordinator: { snapshot: JjSnapshot | null; refresh(): Promise<JjSnapshot>; mutationCapabilityGranted?: boolean; mutate?: (input: JjMutationInput) => Promise<unknown> }) {
  return async (method: string, payload?: { navigationId?: string; panelId?: string; actionId?: string; input?: unknown }) => {
    const snapshot = coordinator.snapshot ?? await coordinator.refresh();
    if (method === "surface.get" && (payload?.navigationId === undefined || payload.navigationId === "jujutsu.command-center")) return { ok: true as const, result: buildJjSurfaceModel(snapshot, payload?.navigationId) };
    if (method === "panel.get" && payload?.panelId === "jujutsu.command-center") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Jujutsu command center", kind: "command-center" as const, refreshedAt: new Date().toISOString(), content: { kind: "command-center" as const, snapshot, surface: buildJjSurfaceModel(snapshot) } } };
    if (method === "panel.get" && payload?.panelId === "jujutsu.change-graph") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Change graph", kind: "change-graph" as const, refreshedAt: new Date().toISOString(), content: { kind: "change-graph" as const, changes: snapshot.changes } } };
    if (method === "panel.get" && payload?.panelId === "jujutsu.operation-log") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Operation log", kind: "operation-log" as const, refreshedAt: new Date().toISOString(), content: { kind: "operation-log" as const, operations: snapshot.operations } } };
    if (method === "panel.get" && payload?.panelId === "jujutsu.bookmarks") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Bookmarks", kind: "bookmarks" as const, refreshedAt: new Date().toISOString(), content: { kind: "bookmarks" as const, bookmarks: snapshot.bookmarks } } };
    if (method === "panel.get" && payload?.panelId === "jujutsu.workspaces") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Workspaces", kind: "workspaces" as const, refreshedAt: new Date().toISOString(), content: { kind: "workspaces" as const, workspaces: snapshot.workspaces } } };
    if (method === "panel.get" && payload?.panelId === "jujutsu.conflicts") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Conflicts", kind: "conflicts" as const, refreshedAt: new Date().toISOString(), content: { kind: "conflicts" as const, changes: snapshot.changes.filter((change) => change.conflict) } } };
    if (method === "action.execute") {
      if (!coordinator.mutationCapabilityGranted) return { ok: false as const, error: "Jujutsu mutation capability is not granted" };
      if (!coordinator.mutate) return { ok: false as const, error: "Jujutsu mutation handler is unavailable" };
      const input = (payload?.input ?? {}) as { message?: unknown; changeId?: unknown; bookmark?: unknown; revision?: unknown };
      const actionId = payload?.actionId;
      const command = actionId === "describe" && typeof input.message === "string" && input.message.trim() ? ["describe", "-m", input.message.trim()] : actionId === "abandon" && typeof input.changeId === "string" ? ["abandon", input.changeId] : actionId === "squash" && typeof input.changeId === "string" ? ["squash", "-r", input.changeId] : actionId === "rebase" && typeof input.changeId === "string" && typeof input.revision === "string" ? ["rebase", "-r", input.changeId, "-d", input.revision] : actionId === "bookmark-create" && typeof input.bookmark === "string" && typeof input.revision === "string" ? ["bookmark", "create", input.bookmark, "-r", input.revision] : null;
      if (!command) return { ok: false as const, error: `Unsupported or invalid Jujutsu action: ${actionId ?? "unknown"}` };
      return { ok: true as const, result: await coordinator.mutate({ command }) };
    }
    return { ok: false as const, error: `unsupported Jujutsu RPC method: ${method}` };
  };
}
