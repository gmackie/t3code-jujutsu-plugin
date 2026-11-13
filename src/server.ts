import { isAbsolute } from "node:path";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import type { JujutsuConfig } from "./config.ts";
import { buildJjSurfaceModel, createBuiltinJjClient, describeMutation, jjCommand, mutationArgs, type CommandRunner, type JjMutation, type JjSnapshot } from "./jj.ts";
import { VIEWS, viewHtml, type ViewName } from "./views/html.ts";
import type { SnapshotData } from "./views/render.ts";

export const SERVER_INFO = { name: "jujutsu", version: "0.2.0" } as const;

export type JujutsuServerOptions = {
  config: JujutsuConfig;
  run: CommandRunner;
  /** Fallback repository when neither the call nor JJ_PROJECT_ROOT names one. */
  cwd?: string;
};

const root = z.string().optional().describe("Absolute path of the Jujutsu repository; defaults to JJ_PROJECT_ROOT or the server's working directory");
const revision = z.string().min(1).describe("jj revision, e.g. a change id or @");

export function createJujutsuMcpServer(options: JujutsuServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Jujutsu (jj) repository state. Use jj_snapshot to read the working copy, change graph, operation log, bookmarks, workspaces and conflicts of a repository. Changes to the repository are made by people from the Jujutsu panels; run jj yourself for your own edits.",
  });

  const resolveRoot = (override?: string) => {
    const path = override?.trim() || options.config.projectRoot || options.cwd || process.cwd();
    if (!isAbsolute(path)) throw new Error(`The repository path must be absolute, got "${path}"`);
    return path;
  };

  async function snapshotData(path: string): Promise<SnapshotData> {
    const snapshot = await createBuiltinJjClient({ projectRoot: path, run: options.run }).snapshot();
    return {
      root: path,
      snapshot,
      surface: buildJjSurfaceModel(snapshot, { mutationsEnabled: options.config.mutationsEnabled }),
      mutationsEnabled: options.config.mutationsEnabled,
      pollSeconds: options.config.pollSeconds,
      refreshedAt: new Date().toISOString(),
    };
  }

  for (const [name, view] of Object.entries(VIEWS) as [ViewName, (typeof VIEWS)[ViewName]][]) {
    registerAppResource(server, view.title, view.uri, { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: true } } }, async () => ({
      contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: await viewHtml(name), _meta: { ui: { prefersBorder: true } } }],
    }));
  }

  registerAppTool(
    server,
    "jj_snapshot",
    {
      title: "Jujutsu snapshot",
      description: "Read a Jujutsu repository through the jj CLI: working copy, recent changes, operation log, bookmarks, workspaces and conflicted paths. Renders the Jujutsu command center.",
      inputSchema: z.object({ root }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEWS["command-center"].uri, visibility: ["model", "app"] } },
    },
    async ({ root: override }) =>
      result(async () => {
        const data = await snapshotData(resolveRoot(override));
        return { data, text: summarize(data.snapshot) };
      }),
  );

  // Mutations are app-only: a person clicks them in a panel. Agents run jj
  // themselves, and T3 hides these tools from the model.
  const mutate = (path: string | undefined, toMutation: () => JjMutation) =>
    result(async () => {
      if (!options.config.mutationsEnabled) throw new Error("Changes from Jujutsu panels are disabled. Set JJ_MUTATIONS=enabled in the plugin's settings to allow them.");
      const mutation = toMutation();
      const repo = resolveRoot(path);
      await options.run(jjCommand(repo, mutationArgs(mutation)));
      const done = describeMutation(mutation);
      try {
        return { data: { ...(await snapshotData(repo)), done }, text: done };
      } catch (error) {
        // The change landed; only the refresh failed, so this is not an error.
        return { data: { root: repo, done, refreshError: message(error) }, text: `${done} Refreshing the snapshot failed: ${message(error)}` };
      }
    });
  const appOnly = { ui: { visibility: ["app"] } };

  server.registerTool(
    "jj_describe",
    { title: "Describe change", description: "Set the description of a change.", inputSchema: z.object({ root, revision: revision.optional(), message: z.string().min(1).describe("New description") }), annotations: { destructiveHint: false, openWorldHint: false }, _meta: appOnly },
    async (args) => mutate(args.root, () => ({ action: "describe", message: args.message, ...(args.revision ? { revision: args.revision } : {}) })),
  );
  server.registerTool(
    "jj_abandon",
    { title: "Abandon change", description: "Abandon a change; its descendants move onto its parent.", inputSchema: z.object({ root, revision }), annotations: { destructiveHint: true, openWorldHint: false }, _meta: appOnly },
    async (args) => mutate(args.root, () => ({ action: "abandon", revision: args.revision })),
  );
  server.registerTool(
    "jj_squash",
    { title: "Squash change", description: "Squash a change into its parent, keeping the parent's description.", inputSchema: z.object({ root, revision }), annotations: { destructiveHint: true, openWorldHint: false }, _meta: appOnly },
    async (args) => mutate(args.root, () => ({ action: "squash", revision: args.revision })),
  );
  server.registerTool(
    "jj_rebase",
    { title: "Rebase change", description: "Rebase one change onto a destination revision.", inputSchema: z.object({ root, revision, destination: z.string().min(1).describe("Destination revision") }), annotations: { destructiveHint: false, openWorldHint: false }, _meta: appOnly },
    async (args) => mutate(args.root, () => ({ action: "rebase", revision: args.revision, destination: args.destination })),
  );
  server.registerTool(
    "jj_bookmark_create",
    { title: "Create bookmark", description: "Create a bookmark pointing at a revision.", inputSchema: z.object({ root, name: z.string().min(1).describe("Bookmark name"), revision }), annotations: { destructiveHint: false, openWorldHint: false }, _meta: appOnly },
    async (args) => mutate(args.root, () => ({ action: "bookmark-create", name: args.name, revision: args.revision })),
  );

  return server;
}

export function summarize(snapshot: JjSnapshot): string {
  const wc = snapshot.workingCopy;
  const conflicted = snapshot.changes.filter((change) => change.conflict);
  return [
    `Repository: ${snapshot.repoRoot ?? "unknown"}`,
    wc ? `Working copy @ ${wc.changeId ?? "?"}: ${wc.description || "(no description)"}${wc.empty ? " (empty)" : ""}${wc.conflicts > 0 ? `, conflicts in ${snapshot.conflictedPaths.join(", ") || `${wc.conflicts} path(s)`}` : ""}` : "No working copy.",
    `${snapshot.changes.length} changes${conflicted.length ? `, ${conflicted.length} conflicted (${conflicted.map((change) => change.changeId).join(", ")})` : ""}:`,
    ...snapshot.changes.slice(0, 15).map((change) => `- ${change.isWorkingCopy ? "@ " : ""}${change.changeId} ${change.description}${change.bookmarks.length ? ` [${change.bookmarks.join(", ")}]` : ""}${change.conflict ? " (conflict)" : ""}`),
    `Bookmarks: ${snapshot.bookmarks.map((bookmark) => `${bookmark.name}→${bookmark.target}${bookmark.diverged ? " (conflicted)" : ""}`).join(", ") || "none"}`,
    `Workspaces: ${snapshot.workspaces.map((workspace) => `${workspace.name}@${workspace.revision}`).join(", ") || "none"}`,
    `Last operation: ${snapshot.operations[0] ? `${snapshot.operations[0].description} (${snapshot.operations[0].timestamp})` : "none"}`,
  ].join("\n");
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function result(run: () => Promise<{ data: unknown; text: string }>): Promise<CallToolResult> {
  try {
    const { data, text } = await run();
    return { content: [{ type: "text", text }], structuredContent: data as Record<string, unknown> };
  } catch (error) {
    return { content: [{ type: "text", text: message(error) }], isError: true };
  }
}
