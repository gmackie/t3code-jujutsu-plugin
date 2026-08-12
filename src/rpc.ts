import { buildJjSurfaceModel, type JjSnapshot } from "./jj.ts";

export function createRpcHandler(coordinator: { snapshot: JjSnapshot | null; refresh(): Promise<JjSnapshot> }) {
  return async (method: string, payload?: { navigationId?: string; panelId?: string }) => {
    const snapshot = coordinator.snapshot ?? await coordinator.refresh();
    if (method === "surface.get" && (payload?.navigationId === undefined || payload.navigationId === "jujutsu.command-center")) return { ok: true as const, result: buildJjSurfaceModel(snapshot, payload?.navigationId) };
    if (method === "panel.get" && payload?.panelId === "jujutsu.command-center") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Jujutsu command center", kind: "command-center" as const, refreshedAt: new Date().toISOString(), content: { kind: "command-center" as const, snapshot, surface: buildJjSurfaceModel(snapshot) } } };
    if (method === "panel.get" && payload?.panelId === "jujutsu.change-graph") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Change graph", kind: "change-graph" as const, refreshedAt: new Date().toISOString(), content: { kind: "change-graph" as const, changes: snapshot.changes } } };
    if (method === "panel.get" && payload?.panelId === "jujutsu.operation-log") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Operation log", kind: "operation-log" as const, refreshedAt: new Date().toISOString(), content: { kind: "operation-log" as const, operations: snapshot.operations } } };
    if (method === "panel.get" && payload?.panelId === "jujutsu.bookmarks") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Bookmarks", kind: "bookmarks" as const, refreshedAt: new Date().toISOString(), content: { kind: "bookmarks" as const, bookmarks: snapshot.bookmarks } } };
    if (method === "panel.get" && payload?.panelId === "jujutsu.workspaces") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Workspaces", kind: "workspaces" as const, refreshedAt: new Date().toISOString(), content: { kind: "workspaces" as const, workspaces: snapshot.workspaces } } };
    if (method === "panel.get" && payload?.panelId === "jujutsu.conflicts") return { ok: true as const, result: { pluginId: "com.t3code.jujutsu", panelId: payload.panelId, title: "Conflicts", kind: "conflicts" as const, refreshedAt: new Date().toISOString(), content: { kind: "conflicts" as const, changes: snapshot.changes.filter((change) => change.conflict) } } };
    return { ok: false as const, error: `unsupported Jujutsu RPC method: ${method}` };
  };
}
