# Jujutsu manifest v2 (T3CODE-75)

`t3-plugin.json` follows the MCP-native plugin design from T3CODE-74, the same shape as the Bob plugin (v0.2.1). T3 loads the manifest into its server-owned MCP registry.

## Shape

- `mcpServer` reuses `McpServerConfig` and `McpServerVariable` from Settings → Tools (`packages/contracts/src/agentTools.ts`):
  - `name`: `jujutsu`.
  - `transport`: stdio, `bun ${pluginRoot}/src/mcp.ts`, with `env` as `McpServerVariable[]`. No variable is secret.
- `contributes.panels[]`, one `ui://` view per v1 panel. All six share one bundled script, and each resource fixes its section with `<main data-section>`.
- `contributes.commands[]` open each panel. They replace the v1 `navigation` entries.
- `t3Tools` is `[]`. v1 had no thread or T3 grants, and the plugin never calls T3.

There is no `runtime`, `hooks`, `settings`, `settingsPanels` or `capabilities`.

## v1 → v2 mapping

The v1 manifest's last version is at commit 2356ccd.

| v1 | v2 |
|---|---|
| `runtime` (managed-app, `bun src/stdio.ts`, RPC `surface.get` / `panel.get` / `action.execute`) | `mcpServer.transport` (stdio, `bun ${pluginRoot}/src/mcp.ts`) |
| `surface.get` / `panel.get` (all panels read one snapshot) | Tool `jj_snapshot`, `["model", "app"]`, `_meta.ui.resourceUri: ui://jujutsu/command-center.html` |
| `navigation[jujutsu.command-center]`, `panels[jujutsu.command-center]` (project) | Panel `jujutsu-command-center`, `scope: project`, `ui://jujutsu/command-center.html` |
| `navigation[jujutsu.change-graph]`, `panels[jujutsu.change-graph]` (project) | Panel `jujutsu-change-graph`, `scope: project`, `ui://jujutsu/change-graph.html` |
| `navigation[jujutsu.operation-log]`, `panels[jujutsu.operation-log]` (project) | Panel `jujutsu-operation-log`, `scope: project`, `ui://jujutsu/operation-log.html` |
| `navigation[jujutsu.bookmarks]`, `panels[jujutsu.bookmarks]` (project) | Panel `jujutsu-bookmarks`, `scope: project`, `ui://jujutsu/bookmarks.html` |
| `navigation[jujutsu.workspaces]`, `panels[jujutsu.workspaces]` (project) | Panel `jujutsu-workspaces`, `scope: project`, `ui://jujutsu/workspaces.html` |
| `navigation[jujutsu.conflicts]`, `panels[jujutsu.conflicts]` (thread.sidePanel) | Panel `jujutsu-conflicts`, `scope: thread`, `ui://jujutsu/conflicts.html` |
| `navigation[*].path` | `contributes.commands[]`, one per panel |
| `action.execute` `describe`, `abandon`, `squash`, `rebase`, `bookmark-create` | Tools `jj_describe`, `jj_abandon`, `jj_squash`, `jj_rebase`, `jj_bookmark_create`, all `["app"]` |
| `settings[jujutsu.project-root]` | `JJ_PROJECT_ROOT`. A call's `root` argument and the panel's `hostContext.t3.cwd` come first. |
| `settings[jujutsu.polling-seconds]` (10–3600, default 30) | `JJ_POLL_SECONDS`, clamped to 10–3600 |
| `capabilities.filesystem.write` + `T3_PLUGIN_JJ_MUTATIONS=granted` | `JJ_MUTATIONS=enabled` (default `disabled`), and the mutation tools are app-only |
| `capabilities.filesystem.read` | Dropped. The server process runs `jj` with the user's permissions. |
| `capabilities.ui.embed` | Implied by `panels` |
| `settingsPanels[jujutsu.connection]` | Dropped. T3 shows the `env` variables with their titles in the plugin's install form. |
| `hooks: project.opened, project.changed` | Removed (D4). Views read on open, poll every `JJ_POLL_SECONDS` while visible, and re-read when `hostContext.t3.cwd` changes. |
| `hooks: runtime.error` | Removed. A failed jj call is the tool's error result, and the view shows it. |
| `T3_PLUGIN_COMMAND`, `T3_PLUGIN_SNAPSHOT` (custom JSON snapshot command and fixture) | Removed. `JJ_BIN` replaces a wrapper command, and a fixture snapshot would show data that is not the repository. |
| (new) | `JJ_BIN`: the jj executable, default `jj` |

## Server rules

- **Visibility.** `jj_snapshot` is `["model", "app"]`, so agents can read repository state and views can refresh it. The five mutation tools are `["app"]`: only a person clicking in a panel runs them. Agents run `jj` themselves for their own edits.
- **Repository.** Each tool takes an optional absolute `root`. Without one, it uses `JJ_PROJECT_ROOT`, then the process working directory. Views pass the tool input's `root`, or else `hostContext.t3.cwd`, so a thread panel follows the thread's worktree. Mutations from a view target the repository the view shows.
- **No guessing.** A failed jj command, a timeout (15 s per command) or a missing `jj` is the tool's error result. A mutation whose refresh fails returns the mutation's success with a `refreshError`, never an error.
- **Safe arguments.** Mutations pass values as `--flag=value` or after `--`, and reject revisions that start with `-`. `JJ_EDITOR=false` and a closed stdin make a command that wants an editor fail instead of hanging. `jj_squash` keeps the parent's description (`--use-destination-message`), so it never needs an editor.
- **Working-copy snapshots.** The working-copy read runs first. The other reads run in parallel with `--ignore-working-copy`, so they never race to snapshot.
- **Stateless processes.** T3 runs one stdio copy per agent session plus one in its pool. The server keeps no state: every call reads jj.

## Open questions

1. **Project panels without a cwd.** If T3 opens a project panel without `hostContext.t3.cwd`, the pool copy reads `JJ_PROJECT_ROOT`, or else its own working directory. The view header shows which repository it read.
2. **Panel `tool`.** The panels declare no opening `tool`. Its fixed arguments cannot carry the panel's cwd, so the views fetch `jj_snapshot` themselves.
3. **Workspace roots.** `jj workspace list` has no root in its template, so workspaces show their name and working-copy change only.
